import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { notifyTelegram } from './telegram.js';

const OVERWATCH_DIR = path.join(os.homedir(), '.overwatch');

export function registerCustomTools(api: ExtensionAPI) {
  
  api.registerTool({
    name: "console_log_alert",
    label: "Console Log Alert",
    description: "Sends an alert to the user's console and logs it to ~/.overwatch/alerts.log. Use this to notify the user of any important market events or daemon monitoring alerts.",
    parameters: Type.Object({
      message: Type.String({ description: "The alert message to display to the user" }),
      severity: Type.String({ description: "INFO, WARNING, or CRITICAL" })
    }),
    execute: async (toolCallId, args) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [${args.severity}] ${args.message}\n`;
      
      const logPath = path.join(OVERWATCH_DIR, 'alerts.log');
      fs.appendFileSync(logPath, logEntry, 'utf8');

      // Deliver to Telegram too (no-op if unconfigured; severity-gated there).
      void notifyTelegram({ message: args.message, severity: args.severity });

      console.log(`\n\x1b[33m--- OVERWATCH ALERT [${args.severity}] ---\x1b[0m`);
      console.log(args.message);
      console.log(`\x1b[33m--------------------------------------\x1b[0m\n`);
      
      return {
        content: [{ type: "text", text: "Alert successfully logged and displayed to the user." }],
        details: { logged: true }
      };
    }
  });

}
