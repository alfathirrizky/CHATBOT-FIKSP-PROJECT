const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function testGemini() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [
      {
        googleSearch: {},
      },
    ],
  });

  const prompt = "Berikan analisis sentimen untuk konten di link ini: https://www.instagram.com/p/C0O1z33LK1b/ . Jika tidak bisa membaca langsung, gunakan Google Search untuk mencari informasi tentang link tersebut.";

  try {
    const result = await model.generateContent(prompt);
    console.log(result.response.text());
  } catch (err) {
    console.error("Error:", err.message);
  }
}

testGemini();
