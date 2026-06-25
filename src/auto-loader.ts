import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SKILLS_DIR = path.join(os.homedir(), '.overwatch', 'skills');

export function setupAutoLoader(api: ExtensionAPI) {
  api.on("context", async (event) => {
    const messages = event.messages;
    if (messages.length === 0) return;

    // Find the last user message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') return;

    const content = typeof lastMessage.content === 'string' 
        ? lastMessage.content.toLowerCase() 
        : Array.isArray(lastMessage.content) 
            ? lastMessage.content.map((c: any) => c.text || '').join(' ').toLowerCase()
            : '';

    const activeSkills: string[] = [];

    if (content.includes('risk') || content.includes('stop loss') || content.includes('drawdown')) {
        activeSkills.push('risk-gate.md');
    }
    if (content.includes('size') || content.includes('quantity') || content.includes('how many')) {
        activeSkills.push('position-sizing.md');
    }
    if (content.includes('momentum') || content.includes('breakout') || content.includes('volume')) {
        activeSkills.push('momentum-raid.md');
    }
    if (content.includes('valuation') || content.includes('invest') || content.includes('fundamentals')) {
        activeSkills.push('valuation-campaign.md');
    }
    if (content.includes('monitor') || content.includes('alert') || content.includes('daemon')) {
        activeSkills.push('monitor-builder.md');
    }

    if (activeSkills.length > 0) {
        let injectedContext = "### AUTO-LOADED SKILLS (DOCTRINE)\n\n";
        for (const skill of activeSkills) {
            const skillPath = path.join(SKILLS_DIR, skill);
            if (fs.existsSync(skillPath)) {
                injectedContext += `--- BEGIN ${skill} ---\n`;
                injectedContext += fs.readFileSync(skillPath, 'utf8') + "\n";
                injectedContext += `--- END ${skill} ---\n\n`;
            }
        }

        // We inject the loaded skills as a developer/system message right before the latest user message
        const newMessages = [...messages];
        
        // Find index of the last user message
        const lastUserIndex = newMessages.length - 1;
        
        // Inject a custom system message
        newMessages.splice(lastUserIndex, 0, {
            role: "system",
            content: injectedContext
        } as any);

        return {
            messages: newMessages
        };
    }
  });
}
