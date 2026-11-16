import kuromoji from "kuromoji/build/kuromoji.js";

const kana = {
  あ: "a", い: "i", う: "ɯ", え: "e", お: "o", ぁ: "a", ぃ: "i", ぅ: "ɯ", ぇ: "e", ぉ: "o",
  か: "ka", き: "kʲi", く: "kɯ", け: "ke", こ: "ko",
  が: "ɡa", ぎ: "ɡʲi", ぐ: "ɡɯ", げ: "ɡe", ご: "ɡo",
  さ: "sa", し: "ɕi", す: "sɨ", せ: "se", そ: "so",
  ざ: "ʣa", じ: "ʥi", ず: "zɨ", ぜ: "ʣe", ぞ: "zo",
  た: "ta", ち: "ʨi", つ: "ʦɨ", て: "te", と: "to",
  だ: "da", ぢ: "ʥi", づ: "zɨ", で: "de", ど: "do",
  な: "na", に: "ɲi", ぬ: "nɯ", ね: "ne", の: "no",
  は: "ha", ひ: "çi", ふ: "ɸɯ", へ: "he", ほ: "ho",
  ば: "ba", び: "bʲi", ぶ: "bɯ", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pʲi", ぷ: "pɯ", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mʲi", む: "mɯ", め: "me", も: "mo",
  や: "ja", ゆ: "jɯ", よ: "jo", ゃ: "ja", ゅ: "jɯ", ょ: "jo",
  ら: "ɾa", り: "ɾʲi", る: "ɾɯ", れ: "ɾe", ろ: "ɾo",
  わ: "βa", ゐ: "i", ゑ: "e", を: "o", ん: "ɴ", ゔ: "vɯ", っ: "ʔ", "ー": "ː",
};
const twoKana = {
  きゃ: "kʲa", きゅ: "kʲɯ", きょ: "kʲo",
  ぎゃ: "ɡʲa", ぎゅ: "ɡʲɯ", ぎょ: "ɡʲo",
  しゃ: "ɕa", しゅ: "ɕɯ", しょ: "ɕo", しぇ: "ɕe",
  じゃ: "ʥa", じゅ: "ʥɯ", じょ: "ʥo", じぇ: "ʥe",
  ちゃ: "ʨa", ちゅ: "ʨɯ", ちょ: "ʨo", ちぇ: "ʨe",
  にゃ: "ɲa", にゅ: "ɲɯ", にょ: "ɲo",
  ひゃ: "ça", ひゅ: "çɯ", ひょ: "ço",
  びゃ: "bʲa", びゅ: "bʲɯ", びょ: "bʲo",
  ぴゃ: "pʲa", ぴゅ: "pʲɯ", ぴょ: "pʲo",
  みゃ: "mʲa", みゅ: "mʲɯ", みょ: "mʲo",
  りゃ: "ɾʲa", りゅ: "ɾʲɯ", りょ: "ɾʲo",
  ふぁ: "ɸa", ふぃ: "ɸi", ふぇ: "ɸe", ふぉ: "ɸo",
  てぃ: "ti", でぃ: "di", とぅ: "tɯ", どぅ: "dɯ",
  つぁ: "ʦa", つぃ: "ʦi", つぇ: "ʦe", つぉ: "ʦo",
  うぃ: "βi", うぇ: "βe", うぉ: "βo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
};
const punctuation = { "。": ".", "、": ",", "「": "“", "」": "”", "・": " " };
const digits = ["ゼロ", "イチ", "ニ", "サン", "ヨン", "ゴ", "ロク", "ナナ", "ハチ", "キュウ"];
let tokenizerPromise;

function loadTokenizer(dictionaryUrl) {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dictionaryUrl }).build((error, tokenizer) => {
        if (error) reject(new Error("The Japanese pronunciation dictionary could not be loaded."));
        else resolve(tokenizer);
      });
    }).catch((error) => {
      tokenizerPromise = undefined;
      throw error;
    });
  }
  return tokenizerPromise;
}

function convert(reading) {
  const text = reading.normalize("NFKC")
    .replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const pair = twoKana[text.slice(index, index + 2)];
    if (pair) {
      result += pair;
      index++;
    } else {
      result += kana[char] ?? punctuation[char] ?? char;
    }
  }
  return result;
}

export async function japanesePhonemes(text, dictionaryUrl) {
  const tokenizer = await loadTokenizer(dictionaryUrl);
  const spoken = text.normalize("NFKC").replace(/[0-9]/g, (digit) => digits[Number(digit)]);
  let result = "";
  for (const token of tokenizer.tokenize(spoken)) {
    const reading = token.pronunciation ?? token.reading ?? token.surface_form;
    const segment = convert(reading);
    if (/^[,.!?…“” ]/u.test(segment)) result = result.trimEnd();
    result += segment;
    if (!["助詞", "助動詞", "記号"].includes(token.pos)) result += " ";
  }
  return result.trim();
}
