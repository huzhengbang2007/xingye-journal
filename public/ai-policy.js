export function dailyLimit(value = 100) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100)
    throw new Error('每日 AI 调用上限应为 0–100 的整数');
  return limit;
}
