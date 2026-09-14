import { pingAll } from "../../ping/ping.service.js";
import { getEnvConfig } from "../../../config/env.js";
import type { AITool } from "../ai.tools.js";

export const jenkinsTools: AITool[] = [
  {
    name: "get_jenkins_status",
    description: "Get the current status of the Jenkins CI/CD server, including if it is online and its response time.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      const envConfig = getEnvConfig();
      if (!envConfig.jenkins.serverUrl) {
        return { error: "Jenkins server URL is not configured in .env" };
      }

      const result = await pingAll(
        [{ name: "Jenkins", url: envConfig.jenkins.serverUrl }],
        5000,
      );
      return result[0];
    }
  }
];
