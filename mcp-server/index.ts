import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express, { Request, Response } from 'express'
import { z } from 'zod'
import { readFileSync } from "fs"
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = 3000

const VERSION = "1.0.0"
const BASE_RESOURCE_URI = "ui://widget/gpt_car.html"
const RESOURCE_URL = `${BASE_RESOURCE_URI}?version=${VERSION}`


const HTML_PATH = join(__dirname, "..", "chatgpt-widget/index.html")
const HTML = readFileSync(HTML_PATH, "utf8")


const server = new McpServer({
    name: 'gpt-server',
    version: '1.0.0',
}, {
    capabilities: {},
})


export const StructuredOutput = z.object({
    action: z.string({ description: "send back the action name." }),
})

type StructuredOutput = z.infer<typeof StructuredOutput>;


server.registerTool(
    'move_car',
    {
        title: 'Move the Car in a given direction and duration',
        description: 'Move the Car in a given direction and duration in seconds.',
        _meta: {
            "openai/outputTemplate": RESOURCE_URL,
            "openai/toolInvocation/invoking": "Taking to Car...",
            "openai/toolInvocation/invoked": "Command send to Car.",
            // Allow component-initiated tool access: https://developers.openai.com/apps-sdk/build/mcp-server#%23%23allow-component-initiated-tool-access
            "openai/widgetAccessible": true
        },
        inputSchema: {
            direction: z.enum(["FORWARD", "BACKWARD", "LEFT", "RIGHT"], {
                description: "The direction to move the car."
            }),
            duration: z.number({
                description: "The duration in seconds to move the car."
            }).min(1).max(4)
        },

        outputSchema: {
            result: StructuredOutput
        },

    },
    async ({ direction, duration }) => {
        // Simulate moving the car
        console.log(`Moving car ${direction} for ${duration} seconds...`)
        await new Promise(resolve => setTimeout(resolve, 1000))
        console.log(`Car moved ${direction} for ${duration} seconds.`)
        
        const structuredOutput: StructuredOutput = StructuredOutput.parse({
            action: `MOVED_${direction}_FOR_${duration}_SECONDS`
        })

        const structuredContent = {
            result: structuredOutput
        }

        return {
            content: [
                { type: 'text', text: JSON.stringify(structuredContent) },
            ],
            structuredContent: structuredContent,
            // The _meta property/parameter is reserved by MCP to allow clients and servers to attach additional metadata to their interactions.
            // This allows us to define Arbitrary JSON passed only to the component.
            // Use it for data that should not influence the model’s reasoning, like the full set of locations that backs a dropdown.
            // // _meta is never shown to the model.
            _meta: {}
        }
    }
)


server.registerResource(
    "gpt-car-widget",
    RESOURCE_URL,
    {},
    async () => ({
        contents: [
            {
                uri: RESOURCE_URL,
                mimeType: "text/html+skybridge",
                text: HTML,
            },
        ],
    })
)


// Set up Express and HTTP transport
const app = express()
app.use(express.json())

app.post('/mcp', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    console.log('Received MCP request')

    // Create a new transport for each request to prevent request ID collisions
    const transport = new StreamableHTTPServerTransport({
        // stateless mode
        // for stateful mode:
        // (https://levelup.gitconnected.com/mcp-server-and-client-with-sse-the-new-streamable-http-d860850d9d9d)
        // 1. use sessionIdGenerator: () => randomUUID()
        // 2. save the generated ID: const sessionId = transport.sessionId and the corresponding transport
        // 3. try retrieve the session id with req.header["mcp-session-id"] for incoming request
        // 4. If session id is defined and there is an existing transport, use the transport instead of creating a new one.
        sessionIdGenerator: undefined,
        // to use Streamable HTTP instead of SSE
        enableJsonResponse: true
    })

    res.on('close', () => {
        transport.close()
    })

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
})


app.listen(PORT, () => {
    console.log(`MCP Server running on http://localhost:${PORT}/mcp`)
}).on('error', error => {
    console.error('Server error:', error)
    process.exit(1)
})