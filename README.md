# Lexa - Polymarket AI Assistant

A Next.js application that allows users to interact with an AI assistant to query and discover Polymarket prediction markets.

## Features

- 🤖 AI-powered chat interface for querying Polymarket markets
- 🔍 Filter markets by category (crypto, politics, sports, etc.)
- 📊 Filter markets by Yes rate percentage
- 📈 Sort markets by volume
- 🎨 Modern, responsive UI built with Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- Hugging Face token (for AI chat functionality via Groq)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file in the root directory:
```env
HF_TOKEN=your_huggingface_token_here
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage Examples

- "List me all the Polymarket markets related to crypto"
- "What are the best markets in politics right now with Yes rate more than 90%?"
- "Show me top 10 crypto markets"
- "Find markets about technology with Yes rate above 80%"

## Tech Stack

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Hugging Face Router API** - AI chat functionality (using Groq's gpt-oss-20b model)
- **Polymarket API** - Market data

## Project Structure

```
lexa-fe/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts      # Chat API endpoint
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Home page
│   └── globals.css           # Global styles
├── components/
│   ├── ChatInterface.tsx     # Main chat component
│   ├── MessageList.tsx       # Message display
│   ├── MessageInput.tsx      # Input component
│   └── MarketCard.tsx        # Market card display
├── lib/
│   ├── ai.ts                 # AI query processing
│   └── polymarket.ts         # Polymarket API integration
└── types/
    ├── chat.ts               # Chat types
    └── polymarket.ts         # Polymarket types
```

## Environment Variables

- `HF_TOKEN` - Your Hugging Face token (required for AI functionality)

## License

MIT

