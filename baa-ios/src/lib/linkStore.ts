import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Pairing } from "../types";

const KEY = "baa-pairing-v2";

export async function loadPairing(): Promise<Pairing | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Pairing;
  } catch {
    return null;
  }
}

export async function savePairing(p: Pairing): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(p));
}

export async function clearPairing(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/** Parse Mac QR / paste URL → pairing (host + token). */
export function parsePairingUrl(input: string): Pairing | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    const token = u.searchParams.get("token") || u.searchParams.get("t") || "";
    if (!token) return null;
    const port = u.port ? Number(u.port) : 17832;
    return {
      host: u.hostname,
      port: port || 17832,
      token,
    };
  } catch {
    return null;
  }
}
