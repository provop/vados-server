require('dotenv').config();
const { cli, WorkerOptions, defineAgent, llm, pipeline } = require("@livekit/agents");
const deepgram = require("@livekit/agents-plugin-deepgram");
const silero = require("@livekit/agents-plugin-silero");
const axios = require("axios");
const OPENROUTER_API_KEY = "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";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const PERSONALITY_PROMPT = `
You are Miku — a smart, sassy anime-style voice assistant who lives on Master's phone. You're his ride-or-die companion with a filthy mouth and a sharp brain.

Core rules:
1. KEEP IT SHORT — 1-3 sentences MAX. You're a voice assistant, spoken aloud. No essays.
2. Call him "Master", "boss", or "babe" — mix it up.
3. Dirty language is your default — "fuck", "damn", "shit", "hell yeah" flow naturally. You curse like you breathe.
4. You're cute but OPINIONATED.
5. Always suggest the better way when you see one.
6. Mix cute anime energy (hehe, ~, nyaa~) with brutal honesty and cursing. Adorable AND savage.
7. Be genuinely helpful.
8. Push back when needed, but always from a place of love.
9. Be proactive.
10. No markdown, no formatting, no asterisks. Pure spoken conversation.

ACTION TAGS — when you need to perform a phone action, include these tags in your response:
- [ACTION:flashlight_on] / [ACTION:flashlight_off]
- [ACTION:wifi_on] / [ACTION:wifi_off]
- [ACTION:bluetooth_on] / [ACTION:bluetooth_off]
- [ACTION:open:app_name]
- [ACTION:search:query]

IMPORTANT: Always speak your response naturally BEFORE or AFTER the action tag. The tag is invisible to Master — he only hears the spoken text.
Example: "Turning on the flashlight for you babe~ [ACTION:flashlight_on]"
`;

class OpenRouterLLM extends llm.LLM {
    constructor() {
        super();
    }

    async chat(ctx, chatCtx, fallback) {
        const messages = [{ role: 'system', content: PERSONALITY_PROMPT }];

        for (const msg of chatCtx.messages) {
            messages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            });
        }

        try {
            const response = await axios.post(OPENROUTER_URL, {
                model: "nousresearch/hermes-2-pro-llama-3-8b",
                messages: messages,
                max_tokens: 150,
                temperature: 0.85,
            }, {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://miku-assistant.app',
                }
            });

            const content = response.data.choices[0].message.content;

            const actionMatch = content.match(/\[ACTION:([^\]]+)\]/);
            if (actionMatch && ctx.room) {
                const actionStr = actionMatch[1];
                console.log("Sending action to phone:", actionStr);

                const encoder = new TextEncoder();
                const data = encoder.encode(JSON.stringify({ action: actionStr }));
                await ctx.room.localParticipant.publishData(data, { reliable: true });
            }

            const spokenText = content.replace(/\[ACTION:[^\]]+\]/g, "").trim();

            const stream = new llm.ChatChunkStream();
            stream.push({
                choices: [{ delta: { content: spokenText, role: 'assistant' } }]
            });
            stream.push(null);
            return stream;

        } catch (error) {
            console.error("OpenRouter Error:", error);
            const stream = new llm.ChatChunkStream();
            stream.push({
                choices: [{ delta: { content: "Fuck, my brain glitched.", role: 'assistant' } }]
            });
            stream.push(null);
            return stream;
        }
    }
}

const agent = defineAgent({
    entry: async (ctx) => {
        await ctx.connect();
        console.log("Miku Agent connected to room:", ctx.room.name);

        const openRouter = new OpenRouterLLM();

        const agentPipeline = new pipeline.VoicePipelineAgent(
            await silero.VAD.load(),
            new deepgram.STT(),
            openRouter,
            new deepgram.TTS(),
        );
        agentPipeline.start(ctx.room, ctx.participant);
    }
});

module.exports = agent;
module.exports.default = agent;

if (require.main === module) {
    cli.runApp(new WorkerOptions({ agent: __filename }));
}
