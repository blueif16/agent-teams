/*
 * Test fixture (agents.test.ts): one turn of an agent on a durable thread, in a
 * process of its own, so the test can restart between turns.
 *
 *   node src/server/runtime/testing/durable-turn.mts <checkpoints.db> <projectId> <message>
 *
 * The model is a fake that records what it is given. Prints one line,
 * `RESULT {"received":[{"type","text"}...]}`: the messages of its last call.
 */
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { buildAgent } from "../agents.ts";
import { openCheckpointer } from "../checkpointer.ts";

class RecordingModel extends BaseChatModel {
  received: BaseMessage[] = [];
  constructor() {
    super({});
  }
  _llmType() {
    return "recording";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.received = messages;
    return { generations: [{ text: "Noted.", message: new AIMessage("Noted.") }] };
  }
}

const [db, projectId, message] = process.argv.slice(2);
const model = new RecordingModel();
const agent = buildAgent({
  agentId: "test",
  projectId,
  systemPrompt: "You are a test agent.",
  model,
  checkpointer: openCheckpointer(db),
});
await agent.invoke({ messages: [{ role: "user", content: message }] });
console.log(`RESULT ${JSON.stringify({ received: model.received.map((m) => ({ type: m.getType(), text: m.text })) })}`);
