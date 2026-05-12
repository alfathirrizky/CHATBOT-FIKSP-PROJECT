require("dotenv").config();
const { Telegraf } = require("telegraf");
const xlsx = require("xlsx");
const path = require("path");
const axios = require("axios");
const fs = require("fs");
const cheerio = require("cheerio");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { YoutubeTranscript } = require("youtube-transcript");
const schedule = require("node-schedule");

const bot = new Telegraf(process.env.BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fungsi membaca Excel/CSV
function readExcelData() {
  try {
    // Pastikan membaca dari folder database
    const filePath = path.join(__dirname, "database", path.basename(process.env.FILE_PATH));
    const workbook = xlsx.readFile(filePath);
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

const schedulesPath = path.join(__dirname, "database", "schedules.json");

// Helper untuk membaca dan menyimpan jadwal
function loadSchedules() {
  if (fs.existsSync(schedulesPath)) {
    try {
      const data = fs.readFileSync(schedulesPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error("Gagal membaca jadwal:", err);
      return [];
    }
  }
  return [];
}

function saveSchedules(schedules) {
  fs.writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2), 'utf8');
}

// Global state untuk menyimpan job id
let scheduleJobs = {};

function scheduleReminder(ctx, scheduleData) {
  const { id, dateStr, message, chatId } = scheduleData;
  const dateObj = new Date(dateStr);
  
  if (dateObj < new Date()) return;
  
  const job = schedule.scheduleJob(dateObj, async function() {
    try {
      const urlRegex = /(https?:\/\/[^\s]+)/;
      const match = message.match(urlRegex);
      const keyboard = match ? { inline_keyboard: [[{ text: "🔗 Buka Tautan (Zoom/Meet)", url: match[0] }]] } : undefined;

      await bot.telegram.sendMessage(chatId, `⏰ *PENGINGAT JADWAL* ⏰\n\nKegiatan: ${message}`, { 
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      
      let schedules = loadSchedules();
      schedules = schedules.filter(s => s.id !== id);
      saveSchedules(schedules);
      delete scheduleJobs[id];
    } catch (err) {
      console.error("Gagal mengirim pengingat:", err);
    }
  });
  
  if (job) {
    scheduleJobs[id] = job;
  }
}

function initSchedules() {
  const schedules = loadSchedules();
  const validSchedules = [];
  schedules.forEach(s => {
    if (new Date(s.dateStr) >= new Date()) {
      scheduleReminder(null, s);
      validSchedules.push(s);
    }
  });
  saveSchedules(validSchedules);
}
initSchedules();

// 1. Welcome Message
bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `Halo *${ctx.from.first_name}*! 👋\n\n` +
      `Selamat datang di *Sistem Informasi FIKSP Jakarta*.\n\n` +
      `Fitur yang tersedia:\n` +
      `1. Ketik kata kunci wilayah untuk mencari data di Excel.\n` +
      `2. Ketik /tanya [pertanyaan] untuk mencari info dari dokumen Laporan Monitoring HLM TP2DD Tahun 2025.\n` +
      `3. Kirim file PDF baru untuk dirangkum otomatis.\n` +
      `4. Kirim link YouTube untuk merangkum isi video.\n` +
      `5. Kirim pesan suara (voice) atau file audio untuk merangkum isinya.\n` +
      `6. Ketik /jadwal [YYYY-MM-DD HH:MM] [Kegiatan] untuk membuat pengingat jadwal.\n` +
      `7. Ketik /listjadwal untuk melihat daftar jadwal Anda.\n` +
      `8. Kirim link artikel untuk menganalisa sentimen kontennya.`
  );
});
// 2. Fitur Tanya Jawab Dokumen PDF Lokal (Sesuai PDF yang dikirim)
bot.command("tanya", async (ctx) => {
  const question = ctx.message.text.replace("/tanya", "").trim();
  if (!question) {
    return ctx.reply(
      "Mohon sertakan pertanyaan.\nContoh: /tanya Apa alasan penggunaan QRIS Tap menurun?",
    );
  }
  // Nama file PDF disesuaikan dengan file Nota Dinas dan diambil dari folder database
  const localPdfPath = path.join(
    __dirname,
    "database",
    "20260410_ND_BIRO PERKEU  KE ASPERKEU_LAP MONITORING TL REKOMENDASI HLM TP2DD TAHUN 2025.pdf",
  );
  if (!fs.existsSync(localPdfPath)) {
    return ctx.reply("File PDF Nota Dinas tidak ditemukan di folder project.");
  }
  const loadingMsg = await ctx.reply(
    "Membaca Dokumen untuk mencari jawaban...",
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
    const formattedAnswer = `JAWABAN DARI DOKUMEN TP2DD:\n\n${answer}`;
    await sendLongMessage(ctx, loadingMsg.message_id, formattedAnswer);
  } catch (error) {
    console.error("Error membaca PDF lokal:", error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Gagal mencari jawaban di dokumen internal.",
      )
      .catch(() => {});
  }
});

function formatGoogleCalendarDate(dateObj) {
  return dateObj.toISOString().replace(/-|:/g, '').split('.')[0] + 'Z';
}

function getGoogleCalendarLink(title, dateObj) {
  const startDate = formatGoogleCalendarDate(dateObj);
  const endDateObj = new Date(dateObj.getTime() + 60 * 60 * 1000); // 1 jam setelahnya
  const endDate = formatGoogleCalendarDate(endDateObj);
  
  const text = encodeURIComponent(title);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${startDate}/${endDate}`;
}

// Fitur Pencatat dan Pengingat Jadwal
bot.command('jadwal', (ctx) => {
  const input = ctx.message.text.replace('/jadwal', '').trim();
  if (!input) {
    return ctx.reply("Format salah. Gunakan: /jadwal YYYY-MM-DD HH:MM [Kegiatan]\nContoh: /jadwal 2026-05-12 14:00 Rapat Tim https://zoom.us/j/123...");
  }
  
  const parts = input.split(' ');
  if (parts.length < 3) {
    return ctx.reply("Format salah. Gunakan: /jadwal YYYY-MM-DD HH:MM [Kegiatan]\nContoh: /jadwal 2026-05-12 14:00 Rapat Tim https://zoom.us/j/123...");
  }
  
  const datePart = parts[0];
  const timePart = parts[1];
  const messagePart = parts.slice(2).join(' ');
  
  const dateStr = `${datePart}T${timePart}:00+07:00`;
  const dateObj = new Date(dateStr);
  
  if (isNaN(dateObj.getTime())) {
    return ctx.reply("Format tanggal/waktu tidak valid. Pastikan menggunakan YYYY-MM-DD HH:MM");
  }
  
  if (dateObj < new Date()) {
    return ctx.reply("Waktu tidak boleh di masa lalu!");
  }
  
  const newSchedule = {
    id: Date.now().toString(),
    dateStr: dateObj.toISOString(),
    displayDate: `${datePart} ${timePart}`,
    message: messagePart,
    chatId: ctx.chat.id
  };
  
  const schedules = loadSchedules();
  schedules.push(newSchedule);
  saveSchedules(schedules);
  
  scheduleReminder(ctx, newSchedule);
  
  const gcalLink = getGoogleCalendarLink(newSchedule.message, dateObj);
  
  ctx.reply(`✅ Jadwal berhasil dicatat!\n\n📅 Waktu: ${newSchedule.displayDate}\n📝 Kegiatan: ${newSchedule.message}\n\nSaya akan mengingatkan Anda saat waktunya tiba.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📅 Tambahkan ke Kalender", url: gcalLink }]
      ]
    }
  });
});

bot.command('listjadwal', (ctx) => {
  const schedules = loadSchedules().filter(s => s.chatId === ctx.chat.id);
  if (schedules.length === 0) {
    return ctx.reply("Anda belum memiliki jadwal kegiatan yang tercatat.");
  }
  
  let msg = "📋 *DAFTAR JADWAL KEGIATAN*\n\n";
  schedules.forEach((s, i) => {
    msg += `${i+1}. ${s.displayDate} - ${s.message}\n`;
  });
  
  ctx.replyWithMarkdown(msg);
});

// 3. Logika Pencarian Excel (Text Search) dan YouTube Link
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const keyword = text.toLowerCase();

  // Deteksi Link YouTube
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
  if (youtubeRegex.test(text)) {
    const loadingMsg = await ctx.reply("Mengunduh transkrip YouTube dan merangkum video...");
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(text);
      const transcriptText = transcript.map(t => t.text).join(" ");
      
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `Buatkan rangkuman yang informatif dan terstruktur dalam Bahasa Indonesia dari transkrip video YouTube berikut. Ambil poin-poin penting dan gagasan utamanya.\n\nTranskrip:\n${transcriptText}\n\nPENTING: JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;
      
      const result = await model.generateContent(prompt);
      const summary = result.response.text();
      const formattedResponse = `RANGKUMAN VIDEO YOUTUBE:\n\n${summary}`;
      
      await sendLongMessage(ctx, loadingMsg.message_id, formattedResponse);
    } catch (error) {
      console.error("Error processing YouTube link:", error);
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          "Gagal merangkum video YouTube. Pastikan link valid dan video memiliki subtitle/CC (Closed Captions) yang aktif."
        )
        .catch(() => {});
    }
    return;
  }

  // Deteksi Link Artikel (Abaikan Instagram)
  const urlRegex = /(https?:\/\/[^\s]+)/;
  if (urlRegex.test(text) && !youtubeRegex.test(text)) {
    const url = text.match(urlRegex)[0];
    
    // Fitur analisa sentimen Instagram dinonaktifkan
    if (url.includes("instagram.com")) {
      return; 
    }

    const loadingMsg = await ctx.reply("Membaca tautan dan menganalisa sentimen konten...");
    try {
      const userTextContent = text.replace(url, "").trim();
      let scrapedText = "";
      
      // Untuk artikel web biasa
      try {
        const res = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" } });
        const $ = cheerio.load(res.data);
        const title = $("title").text() || $("meta[property='og:title']").attr("content") || "";
        const desc = $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "";
        const paragraphs = $("p").map((i, el) => $(el).text()).get().join(" ");
        scrapedText = title + "\n" + desc + "\n" + paragraphs;
        scrapedText = scrapedText.replace(/\s+/g, " ").substring(0, 3000); // Batasi 3000 karakter
        
        if (userTextContent) {
          scrapedText = "Catatan Pengguna: " + userTextContent + "\n\nIsi Artikel:\n" + scrapedText;
        }
      } catch (webErr) {
        scrapedText = "Tautan Web: " + url + "\nCatatan Pengguna: " + userTextContent;
      }

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `Analisa sentimen dari konten berikut. Tentukan apakah sentimennya Positif, Negatif, atau Netral. Berikan juga ringkasan alasan mengapa Anda menyimpulkan sentimen tersebut beserta poin-poin utama dari kontennya.\n\nTautan/Konten: ${url}\n\nTeks yang dapat diekstrak:\n${scrapedText}\n\nPENTING: Jika teks yang diekstrak terlalu sedikit dan Anda tidak tahu isinya, jangan mengarang. Katakan saja data tidak cukup. JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;
      
      const result = await model.generateContent(prompt);
      const sentimentAnalysis = result.response.text();
      const formattedResponse = `ANALISA SENTIMEN TAUTAN:\n\n${sentimentAnalysis}`;
      
      await sendLongMessage(ctx, loadingMsg.message_id, formattedResponse);
    } catch (error) {
      console.error("Error processing URL link:", error);
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          "Gagal menganalisa sentimen tautan. Pastikan tautan dapat diakses publik atau coba lagi nanti."
        )
        .catch(() => {});
    }
    return;
  }

  const greetings = ["hi", "halo", "pagi", "siang", "sore", "malam", "tes", "p"];
  if (greetings.includes(keyword)) {
    return ctx.reply(
      `Halo ${ctx.from.first_name}, mau cari data apa hari ini?`,
    );
  }

  // Deteksi Laporan Status (Clear/Error) untuk Smart Sticker Responses
  const isLaporan = keyword.includes("laporan") || keyword.includes("status") || keyword.includes("update");
  const isClear = keyword.includes("clear") || keyword.includes("aman") || keyword.includes("sukses") || keyword.includes("berhasil") || keyword.includes("selesai");
  const isError = keyword.includes("error") || keyword.includes("gagal") || keyword.includes("bug") || keyword.includes("panik") || keyword.includes("kendala") || keyword.includes("masalah");

  // Jika laporan sukses (atau ada kata clear dan bukan kalimat pendek biasa)
  if ((isLaporan && isClear) || (isClear && !isError && text.split(' ').length >= 3)) {
    // Mengirim emoji yang secara otomatis dirender sebagai animated sticker besar oleh Telegram
    await ctx.reply("🥳");
    return ctx.reply("Mantap! Laporan diterima dengan status CLEAR. Kerja bagus! 🎉");
  }

  // Jika ada laporan error
  if (isError) {
    // Mengirim emoji panik yang akan menjadi animated sticker di Telegram
    await ctx.reply("😱");
    
    // Beri jeda sebentar (2 detik) seolah-olah bot sedang panik lalu berpikir
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const loadingMsg = await ctx.reply("Waduh, ada error! Sebentar, saya coba analisis solusi teknisnya...");
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `Sebagai asisten IT profesional, berikan saran solusi teknis singkat dan jelas untuk keluhan/masalah berikut: "${text}". Fokus pada langkah perbaikan praktis. Jangan pakai format markdown berlebihan, gunakan teks biasa saja.`;
      
      const result = await model.generateContent(prompt);
      const answer = result.response.text();
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `💡 *Saran Solusi Teknis:*\n\n${answer}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("Error generating tech solution:", error);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Mohon maaf, saya kesulitan memikirkan solusi saat ini. Harap cek kembali log sistem atau dokumentasi Anda ya. 🛠️"
      );
    }
    return;
  }

  const data = readExcelData();
  if (data.length === 0)
    return ctx.reply("Database sedang kosong atau file tidak terbaca.");
  const results = data.filter((row) =>
    Object.values(row).some((val) =>
      String(val).toLowerCase().includes(keyword),
    ),
  );
  if (results.length > 0) {
    const limitedResults = results.slice(0, 5);
    for (const item of limitedResults) {
      let message = `*Data Ditemukan:*\n───────────────────\n`;
      for (const [key, value] of Object.entries(item)) {
        message += `*${key}*: \`${value}\`\n`;
      }
      await ctx.replyWithMarkdown(message);
    }
    if (results.length > 5) {
      ctx.reply(
        `Ada ${results.length - 5} data lain. Mohon ketik kata kunci lebih spesifik.`,
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
    return ctx.reply("Mohon kirimkan file dengan format PDF.");
  }
  if (document.file_size > 15 * 1024 * 1024) {
    return ctx.reply("Ukuran PDF terlalu besar. Maksimal 15MB ya.");
  }
  const loadingMsg = await ctx.reply("Sedang mengunduh dokumen PDF...");
  try {
    const fileLink = await ctx.telegram.getFileLink(document.file_id);
    const url = typeof fileLink === "string" ? fileLink : fileLink.href;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const pdfBuffer = Buffer.from(response.data);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      "Membaca isi dokumen dan merangkum menggunakan AI...",
    );
    const pdfBase64 = pdfBuffer.toString("base64");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Tolong baca seluruh isi dokumen PDF ini (termasuk hasil scan) dan buatkan rangkuman dalam Bahasa Indonesia. PENTING: JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: pdfBase64, mimeType: "application/pdf" } },
    ]);
    const summary = result.response.text();
    const formattedSummary = `RANGKUMAN PDF (${document.file_name}):\n\n${summary}`;
    await sendLongMessage(ctx, loadingMsg.message_id, formattedSummary);
  } catch (error) {
    console.error("Error Processing PDF:", error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Terjadi kendala teknis saat memproses file PDF 😅",
      )
      .catch(() => {});
  }
});
// 5. Fitur Voice/Audio to Summary (Merangkum Pesan Suara & Audio)
bot.on(["voice", "audio"], async (ctx) => {
  const audioFile = ctx.message.voice || ctx.message.audio;
  // Tingkatkan durasi ke 10 menit
  if (audioFile.duration > 600) {
    return ctx.reply("Durasi pesan suara/audio terlalu panjang. Maksimal 10 menit ya 😊");
  }
  const loadingMsg = await ctx.reply(
    "Mendengarkan dan merangkum audio Anda...",
  );
  try {
    // 1. Dapatkan link file dari Telegram
    const fileLink = await ctx.telegram.getFileLink(audioFile.file_id);
    const url = typeof fileLink === "string" ? fileLink : fileLink.href;
    // 2. Download file audio
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const audioBuffer = Buffer.from(response.data);
    const audioBase64 = audioBuffer.toString("base64");
    // 3. Gunakan Gemini untuk Merangkum
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Tolong dengarkan audio ini dan buatkan rangkuman intinya dalam Bahasa Indonesia. 
Jika ada informasi penting seperti nama, tanggal, angka, atau intruksi, sebutkan dengan jelas. Jika berbentuk percakapan, rangkum topik utamanya.
PENTING: JANGAN gunakan format markdown seperti bintang ganda (**) atau tagar (#). Gunakan teks biasa saja.`;
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: audioBase64,
          mimeType: audioFile.mime_type || "audio/ogg",
        },
      },
    ]);
    const summary = result.response.text();
    const formattedResponse = `RANGKUMAN AUDIO:\n\n${summary}`;
    // 4. Kirim hasil rangkuman
    await sendLongMessage(ctx, loadingMsg.message_id, formattedResponse);
  } catch (error) {
    console.error("Error Processing Audio:", error);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Gagal merangkum audio. Pastikan suara terdengar jelas atau durasinya tidak terlalu pendek.",
      )
      .catch(() => {});
  }
});
bot.launch().then(() => console.log("Bot Telegram FIKSP Aktif!"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));