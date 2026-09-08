// No live service calls in this suite. Tests may explicitly mock fetch/SDKs;
// PostgreSQL uses its separate loopback-only guard, not fetch.
process.env.AGENT_INTERPRETER = 'heuristic'
process.env.OPENAI_API_KEY = ''
process.env.WHATSAPP_ACCESS_TOKEN = ''
process.env.WHATSAPP_MODE = 'simulate'
globalThis.fetch = async () => { throw new Error('External fetch prohibited in Joker tests; use an explicit mock.') }
