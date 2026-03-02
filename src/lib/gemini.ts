import { GoogleGenerativeAI } from '@google/generative-ai';

export async function humanize(content: string, prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_STUDIO_API_KEY must be set');

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: prompt,
  });

  const result = await generativeModel.generateContent(content);
  return result.response.text();
}
