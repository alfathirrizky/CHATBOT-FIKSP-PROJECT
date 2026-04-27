require("dotenv").config();
const axios = require("axios");

async function checkModels() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("API Key tidak ditemukan. Pastikan ada di file .env");
    return;
  }

  console.log("Sedang mengecek daftar model ke server Google...\n");

  try {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    console.log("Model yang BISA kamu gunakan untuk generateContent:");
    console.log("──────────────────────────────────────────────────");

    // Filter model yang mendukung generateContent
    const availableModels = response.data.models.filter((m) =>
      m.supportedGenerationMethods.includes("generateContent"),
    );

    availableModels.forEach((m) => {
      // Menghilangkan prefix "models/" agar nama modelnya bersih
      console.log(`- ${m.name.replace("models/", "")}`);
    });
  } catch (error) {
    console.error(
      "Gagal mengambil data:",
      error.response?.data?.error?.message || error.message,
    );
  }
}

checkModels();
