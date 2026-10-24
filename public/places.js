// Location text stays local until the user explicitly opens a map search.
export function placeQuery(value) {
  const text = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 120) throw new Error('请输入 1–120 字的地点');
  if (/^(?:https?:\/\/|geo:|amap:|baidumap:)/i.test(text))
    throw new Error('请填写地点名称或完整地址，地图分享链接不能当作地址识别');
  return text;
}
export function mapSearch(value) {
  const query = placeQuery(value);
  return (
    'https://uri.amap.com/search?keyword=' + encodeURIComponent(query) + '&src=xingye&callnative=1'
  );
}
