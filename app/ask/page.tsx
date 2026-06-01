import { redirect } from "next/navigation";

export default function AskPage() {
  // /ask deprecated in Phase 8 — replaced by persistent /chat with memory
  redirect("/chat");
}
