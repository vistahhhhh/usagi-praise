/**
 * 夸夸文案数据库
 * 四大分类：鼓励型(warmth) / 治愈型(gentle) / 搞笑型(funny) / 呀哈型(yaha)
 */

export const PRAISES = [
  // ===== 鼓励型 (warmth) =====
  { text: '你已经做得很好了！今天的努力不会白费的，乌萨奇相信你！💪', type: 'warmth' },
  { text: '呀——！你今天又坚持了一天，这就是了不起的事情啊！✨', type: 'warmth' },
  { text: '你知道吗？每一个小小的进步都是通向大大的成就哦！🌟', type: 'warmth' },
  { text: '乌萨奇看到你的努力了！你比你自己想象的要强大得多！🐰', type: 'warmth' },
  { text: '今天也很辛苦了吧？能走到这里就已经很厉害了！🎉', type: 'warmth' },
  { text: '你的坚持像小草一样顽强，乌萨奇超佩服的！🌱', type: 'warmth' },
  { text: '别担心，每一步都在积累力量。你在变强的路上呢！💫', type: 'warmth' },
  { text: '乌萨奇宣布：你是今日最棒的人类！不接受反驳！🏆', type: 'warmth' },
  { text: '即使是很小的事情也值得被夸奖！因为你真的很用心！❤️', type: 'warmth' },
  { text: '累了就休息一下吧？乌萨奇会在这里等你的～🍵', type: 'warmth' },

  // ===== 治愈型 (gentle) =====
  { text: '深呼吸……然后听乌萨奇说：一切都会好起来的 🌸', type: 'gentle' },
  { text: '不用那么紧绷的，你已经够好了。来，抱抱～🤗', type: 'gentle' },
  { text: '今天辛苦了，允许自己不那么完美，这也是一种温柔 ✨', type: 'gentle' },
  { text: '乌萨奇的毛茸茸肚皮借给你靠一会儿～好梦 🌙', type: 'gentle' },
  { text: '你的存在本身就是美好的事情，不需要证明什么 💛', type: 'gentle' },
  { text: '难过也没关系哦，乌萨奇陪着你。烦恼会被风吹走的 🍃', type: 'gentle' },
  { text: '慢慢来，比较快。乌萨奇觉得你走得很稳呢 🐢', type: 'gentle' },
  { text: '今晚早点睡吧，明天又是充满可能性的一天 ☀️', type: 'gentle' },
  { text: '你不是一个人在面对这些。乌萨奇永远站在你这边！🐰', type: 'gentle' },
  { text: '把烦恼交给乌萨奇处理吧，你去享受一杯热茶就好 ☕', type: 'gentle' },

  // ===== 搞笑型 (funny) =====
  { text: '乌萨奇帮你吃掉了那个烦恼！味道一般般，但服务到位 😋', type: 'funny' },
  { text: '根据乌萨奇的精密计算：你今天可爱度上升了300%！📊', type: 'funny' },
  { text: '这个烦恼已经被乌萨奇消化成肥料了，会长出快乐的花！🌻', type: 'funny' },
  { text: '警报解除！乌萨奇已确认你是个超级优秀的人！🚨→✅', type: 'funny' },
  { text: '乌萨奇翻阅了宇宙法则，上面写着"这个人很棒"。真的！📜', type: 'funny' },
  { text: '你的烦恼现在正在被乌萨奇的肚子里的快乐细菌消灭中... 🔬', type: 'funny' },
  { text: '乌萨奇以专业的眼光评估：你的努力程度 = 五颗星 ⭐⭐⭐⭐⭐', type: 'funny' },
  { text: '这个烦恼太没品味了，居然敢烦你！已被乌萨奇驱逐出境 🚫', type: 'funny' },
  { text: '乌萨奇用尾巴扫走了所有不开心！biu~ 🧹✨', type: 'funny' },
  { text: '系统提示：检测到一位很棒的人，已自动触发夸夸程序 🖥️', type: 'funny' },

  // ===== 呀哈型 (yaha) — 乌萨奇风格高能量 =====
  { text: '呀哈！！！你就是最棒的！！乌萨奇为你打Call！！！🔥🔥🔥', type: 'yaha' },
  { text: '呀————哈！！！！冲冲冲！！！没有什么能打倒你！！！⚡', type: 'yaha' },
  { text: 'Ura Ura Ura！！！乌萨奇感受到你的能量了！！！太强啦！！！🎊', type: 'yaha' },
  { text: '呀哈～！烦恼什么的根本不是对手！你才是MVP！👑', type: 'yaha' },
  { text: '呀哈哈哈哈哈！！！你今天也太厉害了吧！！！崇拜脸！！！😍', type: 'yaha' },
  { text: '呀哈！呀哈！呀哈！三连呀哈送给你！接收能量波！！！💥', type: 'yaha' },
  { text: '乌萨奇认证！你！就！是！最！强！的！每个字都带感叹号的那种！', type: 'yaha' },
  { text: '呀哈～烦恼退散！快乐进场！你值得全世界最好的！🌈', type: 'yaha' },
];

/** 已展示过的索引记录（避免短时间内重复） */
let recentIndices = new Set();

/**
 * 获取一条随机夸夸（优先避开最近展示的）
 */
export function getRandomPraise() {
  // 如果最近已经展示了大部分，重置记录
  if (recentIndices.size >= PRAISES.length * 0.7) {
    recentIndices.clear();
  }

  // 尝试找一条未展示的
  let available = PRAISES.map((p, i) => i).filter(i => !recentIndices.has(i));

  if (available.length === 0) {
    recentIndices.clear();
    available = PRAISES.map((_, i) => i);
  }

  const idx = available[Math.floor(Math.random() * available.length)];
  recentIndices.add(idx);

  return PRAISES[idx];
}
