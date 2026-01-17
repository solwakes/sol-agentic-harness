# Sol Agentic Harness

A standalone TypeScript library for building agentic applications with Claude using subscription authentication.

## Features

- **OAuth Token Management**: Uses Claude Code credentials for subscription-based access (no per-token API billing)
- **Streaming API Client**: Full streaming support with proper SSE parsing
- **Built-in Tools**: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, TodoWrite, Task, AskUserQuestion
- **Agent Loop**: Complete agentic loop with tool execution, extended thinking, and multi-turn conversation
- **MCP Support**: Optional MCP protocol support with auto-reconnection, health checks, and graceful degradation
- **Worker Management**: Spawn sub-agents for complex tasks
- **Hook System**: Intercept and modify tool execution via hooks

## Installation

```bash
npm install
npm run build
```

## Usage

```typescript
import { AgentLoop, builtinTools } from 'sol-agentic-harness';

const loop = new AgentLoop();
loop.registerTools(builtinTools);

for await (const event of loop.run({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'claude-sonnet-4-5-20250929',
})) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'tool_use':
      console.log(`Using tool: ${event.name}`);
      break;
    case 'done':
      console.log(`\nDone! Tokens: ${event.totalUsage.input_tokens} in, ${event.totalUsage.output_tokens} out`);
      break;
  }
}
```

## Testing

```bash
npm test
```

## License

MIT
