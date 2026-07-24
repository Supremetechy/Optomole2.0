import OpenAI from "openai";
import process from 'process';

// Initialize the OpenAI client
const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY, // Read from the environment variable
    baseURL: 'https://[workspace-id].ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
});
let isAnswering = false;
async function main() {
    try {
        const messages = [{ role: 'user', content: 'Who are you' }];
        const stream = await openai.chat.completions.create({
            model: 'qwen3.7-max',
            messages,
            stream: true,
            enable_thinking: true
        });
        console.log('\n' + '='.repeat(20) + 'Thinking process' + '='.repeat(20));
        for await (const chunk of stream) {
            if (!chunk.choices.length) continue;
            const delta = chunk.choices[0].delta;
            if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                if (!isAnswering) {
                    process.stdout.write(delta.reasoning_content);
                }
            }
            if (delta.content !== undefined && delta.content) {
                if (!isAnswering) {
                    console.log('\n' + '='.repeat(20) + 'Full response' + '='.repeat(20));
                    isAnswering = true;
                }
                process.stdout.write(delta.content);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}
main();