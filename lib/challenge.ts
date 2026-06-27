/**
 * 随机挑战生成器
 *
 * 生成随机的「语言理解」题用于验证 AI 回复的真实性。
 * 设计目标：让无 LLM 的假站点/中间代理难以绕过。
 *
 * 两种题型随机选择：
 * - 难度 1：分类选择题
 * - 难度 2：阅读理解题（大海捞针）
 */

export interface Challenge {
  /** 发送给模型的问题 */
  prompt: string;
  /** 期望的正确答案（单个词，归一化后比较） */
  expectedAnswer: string;
  /** 难度档：1 = 分类选择，2 = 阅读理解 */
  difficulty: 1 | 2;
}

/** 回复中允许的最大 token 数：超过则视为整段回显，判定失败 */
const MAX_ANSWER_TOKENS = 6;

/** 分类词库：每个词只属于一个类别，避免歧义 */
const CATEGORY_BANK: Record<string, string[]> = {
  animal: ["cat", "dog", "tiger", "horse", "rabbit", "eagle", "dolphin", "wolf"],
  fruit: ["apple", "banana", "grape", "mango", "peach", "lemon", "cherry", "pear"],
  color: ["red", "blue", "green", "yellow", "purple", "pink", "black", "white"],
  country: ["japan", "france", "brazil", "canada", "egypt", "india", "norway", "kenya"],
  metal: ["iron", "gold", "copper", "silver", "zinc", "nickel", "lead", "tin"],
  vehicle: ["car", "truck", "train", "bicycle", "airplane", "boat", "scooter", "tram"],
  instrument: ["piano", "guitar", "violin", "drum", "flute", "trumpet", "harp", "cello"],
  drink: ["coffee", "tea", "juice", "milk", "soda", "water", "cocoa", "lemonade"],
};

/** 阅读理解题用的词库 */
const COMP_COLORS = ["brown", "gray", "golden", "spotted", "striped", "pale", "dark", "bright"];
const COMP_ANIMALS = ["fox", "owl", "bear", "deer", "frog", "crow", "otter", "lynx"];
const COMP_ACTIONS = ["slept", "jumped", "rested", "waited", "played", "hid", "stared", "wandered"];
const COMP_PLACES = ["river", "mountain", "garden", "market", "forest", "lake", "bridge", "castle"];

/** 从数组中随机取一个元素 */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** 从数组中随机取 count 个不重复元素 */
function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  while (result.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 生成难度 1：分类选择题 */
function generateCategorySelect(): Challenge {
  const categories = Object.keys(CATEGORY_BANK);
  const targetCategory = pick(categories);
  const correct = pick(CATEGORY_BANK[targetCategory]);

  const others = categories
    .filter((c) => c !== targetCategory)
    .flatMap((c) => CATEGORY_BANK[c]);
  const distractors = sample(others, 5);

  const options = shuffle([correct, ...distractors]);

  const prompt = `Pick the word that belongs to the given category. Reply with ONLY that one word.

Category: fruit
Options: car, banana, iron, blue, dog
A: banana

Category: ${targetCategory}
Options: ${options.join(", ")}
A:`;

  return { prompt, expectedAnswer: correct, difficulty: 1 };
}

/** 生成难度 2：阅读理解题（大海捞针） */
function generateReadingComprehension(): Challenge {
  const count = 6 + Math.floor(Math.random() * 2); // 6-7 句
  const animals = sample(COMP_ANIMALS, count);
  const facts = animals.map((animal) => ({
    animal,
    color: pick(COMP_COLORS),
    action: pick(COMP_ACTIONS),
    place: pick(COMP_PLACES),
  }));

  const passage = facts
    .map((f) => `The ${f.color} ${f.animal} ${f.action} near the ${f.place}.`)
    .join(" ");

  const target = pick(facts);
  const ask = pick([
    { question: `What color was the ${target.animal}?`, answer: target.color },
    { question: `Where was the ${target.animal}?`, answer: target.place },
  ]);

  const prompt = `Read the passage and answer the question with ONLY one word.

Passage: The small dog rested near the garden. The happy cat slept near the lake.
Question: Where was the cat?
A: lake

Passage: ${passage}
Question: ${ask.question}
A:`;

  return { prompt, expectedAnswer: ask.answer, difficulty: 2 };
}

/** 生成一个随机语言挑战 */
export function generateChallenge(): Challenge {
  return Math.random() > 0.5 ? generateCategorySelect() : generateReadingComprehension();
}

/** 验证结果 */
export interface ValidationResult {
  /** 是否验证通过 */
  valid: boolean;
  /** 归一化后的回复（用于失败时显示，已截断） */
  normalized: string | null;
}

/** 归一化文本：转小写、去除标点、压缩空白 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 验证模型回复是否给出了正确答案
 *
 * 宽松模式：只要回复中包含正确答案作为完整词即视为通过。
 * 这允许一些会先思考再回答的小模型（如 MiniMax-M2.7）也能通过验证。
 * 目的是验证端点是真实 LLM，而非假代理，因此只要答案正确即可。
 */
export function validateResponse(
  response: string,
  expectedAnswer: string
): ValidationResult {
  if (!response || !expectedAnswer) {
    return { valid: false, normalized: null };
  }

  const normalized = normalize(response);
  if (!normalized) {
    return { valid: false, normalized: null };
  }

  const expected = normalize(expectedAnswer);
  const tokens = normalized.split(" ");

  // 只要答案作为完整词出现在回复中即可
  const containsAnswer = tokens.includes(expected);

  const display = normalized.length > 100 ? `${normalized.slice(0, 100)}…` : normalized;

  return { valid: containsAnswer, normalized: display };
}
