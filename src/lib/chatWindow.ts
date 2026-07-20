/**
 * Chat panel window helpers — thin wrappers over panelWindow.
 * Kept for existing imports.
 */
import {
  hidePanelWindow,
  repositionPanelWindow,
  resizePanelWindow,
  showPanelWindow,
} from "./panelWindow";

export const CHAT_WIN_LABEL = "chat";

export async function showChatWindow(large = false): Promise<void> {
  return showPanelWindow("chat", large);
}

export async function hideChatWindow(): Promise<void> {
  return hidePanelWindow("chat");
}

export async function repositionChatWindow(large = false): Promise<void> {
  return repositionPanelWindow("chat", large);
}

export async function resizeChatWindow(large: boolean): Promise<void> {
  return resizePanelWindow("chat", large);
}

export async function closeChatWindow(): Promise<void> {
  return hidePanelWindow("chat");
}
