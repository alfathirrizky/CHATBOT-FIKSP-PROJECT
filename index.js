require("dotenv").config();
const { Telegraf } = require("telegraf");
const xlsx = require("xlsx");
const path = require("path");
const axios = require("axios");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const bot = new Telegraf(process.env.BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fungsi membaca Excel/CSV
function readExcelData() {
  try {
    const workbook = xlsx.readFile(path.join(__dirname, process.env.FILE_PATH));
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) {
    console.error("Gagal membaca file Excel/CSV:", error.message);
    return [];
  }
}

// Fungsi Helper untuk mengirim pesan panjang secara bersambung (Chunking)
async function sendLongMessage(ctx, loadingMsgId, fullText) {
  const MAX_LENGTH = 4000;

  if (fullText.length <= MAX_LENGTH) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsgId,
      undefined,
      fullText,
    );
  } else {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsgId,
      undefined,
      fullText.substring(0, MAX_LENGTH),
    );
    let remainingText = fullText.substring(MAX_LENGTH);
    while (remainingText.length > 0) {
      await ctx.reply(remainingText.substring(0, MAX_LENGTH));
      remainingText = remainingText.substring(MAX_LENGTH);
    }
  }
}

// 1. Welcome Message
bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `Halo *${ctx.from.first_name}*! 👋\n\n` +
      `Selamat datang di *Sistem Informasi FIKSP Jakarta*.\n\n` +
      `Fitur yang tersedia:\n` +
      `1. Ketik kata kunci wilayah untuk mencari data di Excel.\n` +
      `2. Ketik /tanya [pertanyaan] untuk mencari info dari dokumen Laporan Monitoring HLM TP2DD Tahun 2025.\n` +
      `3. Kirim file PDF baru untuk dirangkum otomatis.`,
  );
});

// 2. Fitur Tanya Jawab Dokumen PDF Lokal (Sesuai PDF yang dikirim)
bot.command("tanya", async (ctx) => {
  const question = ctx.message.text.replace("/tanya", "").trim();

  if (!question) {
    return ctx.reply(
      "❌ Mohon sertakan pertanyaan.\nContoh: /tanya Apa alasan penggunaan QRIS Tap menurun?",
    );
  }

  // Nama file PDF disesuaikan dengan file Nota Dinas
  const localPdfPath = path.join(
    __dirname,
    "20260410_ND_BIRO PERKEU  KE ASPERKEU_LAP MONITORING TL REKOMENDASI HLM TP2DD TAHUN 2025.pdf",
  );

  if (!fs.existsSync(localPdfPath)) {
    return ctx.reply(
      "❌ File PDF Nota Dinas tidak ditemukan di folder project.",
    );
  }

  const loadingMsg = await ctx.reply(
    "🔍 Membaca Nota Dinas untuk mencari jawaban...",
  );

  try {
    const pdfBuffer = fs.readFileSync(localPdfPath);
    const pdfBase64 = pdfBuffer.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Anda adalah asisten cerdas untuk Biro Perekonomian dan Keuangan Setda Provinsi DKI Jakarta. 
Berdasarkan dokumen Laporan Monitoring Tindak Lanjut HLM TP2DD Tahun 2025 ini, tolong jawab pertanyaan berikut dengan akurat dan profesional:\n\n"${question}"\n\nJika informasinya berupa tabel atau angka, sampaikan datanya dengan jelas. Jika jawabannya tidak ada di dokumen, sampaikan bahwa datanya tidak tersedia. PENTING: JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: pdfBase64,
          mimeType: "application/pdf",
        },
      },
    ]);

    const answer = result.response.text();
    const formattedAnswer = `📚 JAWABAN DARI DOKUMEN TP2DD:\n\n${answer}`;

    await sendLongMessage(ctx, loadingMsg.message_id, formattedAnswer);
  } catch (error) {
    console.error("Error membaca PDF lokal:", error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "❌ Gagal mencari jawaban di dokumen internal.",
      )
      .catch(() => {});
  }
});

// 3. Logika Pencarian Excel (Text Search)
bot.on("text", async (ctx) => {
  const keyword = ctx.message.text.toLowerCase().trim();
  const greetings = ["hi", "halo", "pagi", "siang", "sore", "tes", "p"];

  if (greetings.includes(keyword)) {
    return ctx.reply(
      `Halo ${ctx.from.first_name}, mau cari data apa hari ini?`,
    );
  }

  const data = readExcelData();
  if (data.length === 0)
    return ctx.reply("❌ Database sedang kosong atau file tidak terbaca.");

  const results = data.filter((row) =>
    Object.values(row).some((val) =>
      String(val).toLowerCase().includes(keyword),
    ),
  );

  if (results.length > 0) {
    const limitedResults = results.slice(0, 5);
    for (const item of limitedResults) {
      let message = `✅ *Data Ditemukan:*\n───────────────────\n`;
      for (const [key, value] of Object.entries(item)) {
        message += `*${key}*: \`${value}\`\n`;
      }
      await ctx.replyWithMarkdown(message);
    }
    if (results.length > 5) {
      ctx.reply(
        `⚠️ Ada ${results.length - 5} data lain. Mohon ketik kata kunci lebih spesifik.`,
      );
    }
  } else {
    ctx.reply(
      `Maaf, tidak ada data yang cocok dengan "${ctx.message.text}" di database.`,
    );
  }
});

// 4. Logika Membaca PDF Kiriman User
bot.on("document", async (ctx) => {
  const document = ctx.message.document;

  if (document.mime_type !== "application/pdf") {
    return ctx.reply("❌ Mohon kirimkan file dengan format PDF.");
  }
  if (document.file_size > 15 * 1024 * 1024) {
    return ctx.reply("❌ Ukuran PDF terlalu besar. Maksimal 15MB ya.");
  }

  const loadingMsg = await ctx.reply("📄 Sedang mengunduh dokumen PDF...");

  try {
    const fileLink = await ctx.telegram.getFileLink(document.file_id);
    const url = typeof fileLink === "string" ? fileLink : fileLink.href;

    const response = await axios.get(url, { responseType: "arraybuffer" });
    const pdfBuffer = Buffer.from(response.data);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      "🤖 Membaca isi dokumen dan merangkum menggunakan AI...",
    );

    const pdfBase64 = pdfBuffer.toString("base64");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Tolong baca seluruh isi dokumen PDF ini (termasuk hasil scan) dan buatkan rangkuman dalam Bahasa Indonesia. PENTING: JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: pdfBase64, mimeType: "application/pdf" } },
    ]);

    const summary = result.response.text();
    const formattedSummary = `📝 RANGKUMAN PDF (${document.file_name}):\n\n${summary}`;

    await sendLongMessage(ctx, loadingMsg.message_id, formattedSummary);
  } catch (error) {
    console.error("Error Processing PDF:", error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "❌ Terjadi kendala teknis saat memproses file PDF.",
      )
      .catch(() => {});
  }
});

// 5. Fitur Voice to Summary (Merangkum Pesan Suara)
bot.on("voice", async (ctx) => {
  const voice = ctx.message.voice;

  // Batasi durasi jika perlu (misal max 2 menit agar tidak overload)
  if (voice.duration > 120) {
    return ctx.reply(
      "❌ Durasi voice note terlalu panjang. Maksimal 2 menit ya.",
    );
  }

  const loadingMsg = await ctx.reply(
    "🎤 Mendengarkan dan merangkum pesan suara Anda...",
  );

  try {
    // 1. Dapatkan link file dari Telegram
    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const url = typeof fileLink === "string" ? fileLink : fileLink.href;

    // 2. Download file voice (.ogg)
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const voiceBuffer = Buffer.from(response.data);
    const voiceBase64 = voiceBuffer.toString("base64");

    // 3. Gunakan Gemini untuk Merangkum
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // PERUBAHAN PENTING: Prompt diubah untuk meminta rangkuman
    const prompt = `Tolong dengarkan pesan suara ini dan buatkan rangkuman intinya dalam Bahasa Indonesia. 
Jika pesan suaranya panjang, ambil poin-poin utamanya saja.
PENTING: JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: voiceBase64,
          mimeType: "audio/ogg",
        },
      },
    ]);

    const summary = result.response.text();
    const formattedResponse = `📝 RANGKUMAN PESAN SUARA:\n\n${summary}`;

    // 4. Kirim hasil rangkuman
    await sendLongMessage(ctx, loadingMsg.message_id, formattedResponse);
  } catch (error) {
    console.error("Error Processing Voice:", error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "❌ Gagal merangkum pesan suara. Pastikan suara terdengar jelas atau durasinya tidak terlalu pendek.",
      )
      .catch(() => {});
  }
});

bot.launch().then(() => console.log("🚀 Bot Telegram FIKSP Aktif!"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
