/** Chat / reaction expressions (short-lived overlays) */
export type PetExpression =
  | "idle"
  | "happy"
  | "thinking"
  | "click"
  | "sad";

/** Legacy life poses — pet no longer walks / sits / lies autonomously. */
export type PetLifeState = "walk" | "sit" | "lie";

export type ChatAttachmentKind = "image" | "text" | "file";

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  kind: ChatAttachmentKind;
  size: number;
  /** data:image/...;base64,... for images */
  dataUrl?: string;
  /** plain text body for text files */
  textContent?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Unix ms — used for Phoning-style timestamps */
  at?: number;
  /** Phoning-style sticker (big emoji bubble) */
  kind?: "text" | "sticker";
  stickerId?: string;
  /** Images / files sent with this message */
  attachments?: ChatAttachment[];
}

export interface AppConfig {
  apiKey?: string | null;
  /** Optional name from Grok login */
  displayName?: string | null;
  model: string;
  systemPrompt: string;
}

export interface ChatResponse {
  message: string;
  expression: string;
}
