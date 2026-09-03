import Darwin
import Foundation
import FoundationModels
import Vision

/// Heap-allocate a UTF-8 C string the Rust side frees with `baa_ai_free`.
private func heapString(_ s: String) -> UnsafeMutablePointer<CChar>? {
    strdup(s)
}

private func jsonObject(_ obj: [String: Any]) -> String {
    guard JSONSerialization.isValidJSONObject(obj),
          let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let s = String(data: data, encoding: .utf8)
    else {
        return #"{"ok":false,"error":"Failed to encode JSON"}"#
    }
    return s
}

private func availabilityPayload() -> [String: Any] {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
        return [
            "available": true,
            "reason": NSNull(),
            "code": NSNull(),
            "model": "apple-intelligence",
        ]
    case .unavailable(let reason):
        let code: String
        let message: String
        switch reason {
        case .deviceNotEligible:
            code = "deviceNotEligible"
            message = "This Mac does not support on-device Apple Intelligence."
        case .appleIntelligenceNotEnabled:
            code = "appleIntelligenceNotEnabled"
            message =
                "Turn on Apple Intelligence in System Settings → Apple Intelligence & Siri, then try again."
        case .modelNotReady:
            code = "modelNotReady"
            message =
                "Apple Intelligence is still downloading on this Mac. Wait a minute and try again."
        @unknown default:
            code = "unknown"
            message = "Apple Intelligence is not available right now."
        }
        return [
            "available": false,
            "reason": message,
            "code": code,
            "model": "apple-intelligence",
        ]
    @unknown default:
        return [
            "available": false,
            "reason": "Apple Intelligence is not available right now.",
            "code": "unknown",
            "model": "apple-intelligence",
        ]
    }
}

private func ocrImageData(_ data: Data) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US", "en-GB", "zh-Hant", "zh-Hans", "ja-JP", "yue-Hant"]
    let handler = VNImageRequestHandler(data: data, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return ""
    }
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: "\n")
}

private func dataFromDataURL(_ url: String) -> Data? {
    guard url.hasPrefix("data:"), let comma = url.firstIndex(of: ",") else { return nil }
    let meta = url[url.startIndex..<comma]
    let payload = String(url[url.index(after: comma)...])
    if meta.contains(";base64") {
        return Data(base64Encoded: payload)
    }
    return payload.data(using: .utf8)
}

private struct ChatTurn {
    let role: String
    let content: String
}

private func parseTurns(_ messagesJSON: String) -> [ChatTurn] {
    guard let data = messagesJSON.data(using: .utf8),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else {
        return []
    }
    var turns: [ChatTurn] = []
    for item in raw {
        let role = (item["role"] as? String) ?? "user"
        var content = (item["content"] as? String) ?? ""
        if let atts = item["attachments"] as? [[String: Any]] {
            for a in atts {
                let name = (a["name"] as? String) ?? "file"
                let kind = (a["kind"] as? String) ?? ""
                if let text = a["textContent"] as? String, !text.isEmpty {
                    let clipped = String(text.prefix(8000))
                    content += "\n\n--- Attached file: \(name) ---\n\(clipped)\n--- end file ---"
                    continue
                }
                if kind == "image", let dataUrl = a["dataUrl"] as? String {
                    if let img = dataFromDataURL(dataUrl), img.count < 8_000_000 {
                        let ocr = ocrImageData(img)
                        if !ocr.isEmpty {
                            content += "\n\n--- Text from attached image (\(name)) ---\n\(ocr)\n--- end image text ---"
                        } else {
                            content += "\n[Image attached: \(name)]"
                        }
                    } else {
                        content += "\n[Image attached: \(name)]"
                    }
                }
            }
        }
        turns.append(ChatTurn(role: role, content: content))
    }
    return turns
}

private func buildPrompt(_ turns: [ChatTurn]) -> String {
    guard let last = turns.last else { return "" }
    let prior = turns.dropLast()
    if prior.isEmpty {
        return last.content
    }
    var hist = "Previous conversation:\n"
    for t in prior.suffix(8) {
        let who = t.role == "assistant" ? "Binky" : "User"
        let clipped = String(t.content.prefix(800))
        hist += "\(who): \(clipped)\n"
    }
    hist += "\nCurrent message:\n\(last.content)"
    return hist
}

private func generate(system: String, messagesJSON: String) async -> String {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
        break
    default:
        var payload = availabilityPayload()
        payload["ok"] = false
        payload["error"] = payload["reason"] ?? "Apple Intelligence is not available."
        payload["message"] = NSNull()
        return jsonObject(payload)
    }

    let turns = parseTurns(messagesJSON)
    let prompt = buildPrompt(turns)
    if prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return jsonObject([
            "ok": false,
            "error": "Empty message.",
            "available": true,
        ])
    }

    do {
        let instructions = system.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "You are Binky, a short, witty desktop companion."
            : system
        let session = LanguageModelSession(instructions: instructions)
        let options = GenerationOptions(temperature: 0.8, maximumResponseTokens: 512)
        let response = try await session.respond(to: prompt, options: options)
        let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            return jsonObject([
                "ok": false,
                "error": "Apple Intelligence returned an empty reply. Try again.",
                "available": true,
            ])
        }
        return jsonObject([
            "ok": true,
            "message": text,
            "available": true,
            "model": "apple-intelligence",
        ])
    } catch {
        return jsonObject([
            "ok": false,
            "error": "Apple Intelligence error: \(error.localizedDescription)",
            "available": true,
        ])
    }
}

final class BaaBox: @unchecked Sendable {
    var value: String = #"{"ok":false,"error":"Apple Intelligence timed out."}"#
}

@_cdecl("baa_ai_status_json")
public func baa_ai_status_json() -> UnsafeMutablePointer<CChar>? {
    heapString(jsonObject(availabilityPayload()))
}

@_cdecl("baa_ai_respond")
public func baa_ai_respond(
    _ system: UnsafePointer<CChar>?,
    _ messagesJSON: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
    let sys = system.map { String(cString: $0) } ?? ""
    let json = messagesJSON.map { String(cString: $0) } ?? "[]"
    let box = BaaBox()
    let sem = DispatchSemaphore(value: 0)
    Task {
        box.value = await generate(system: sys, messagesJSON: json)
        sem.signal()
    }
    _ = sem.wait(timeout: .now() + 40)
    return heapString(box.value)
}

@_cdecl("baa_ai_prewarm")
public func baa_ai_prewarm() {
    Task {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else { return }
        let session = LanguageModelSession()
        session.prewarm()
    }
}

@_cdecl("baa_ai_free")
public func baa_ai_free(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}
