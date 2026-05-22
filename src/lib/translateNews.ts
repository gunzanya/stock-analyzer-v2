import type { NewsItem } from './types.js';

const PHRASE_MAP: [RegExp, string][] = [
  [/\braises guidance\b/gi, '가이던스 상향'],
  [/\bcuts guidance\b/gi, '가이던스 하향'],
  [/\blowers guidance\b/gi, '가이던스 하향'],
  [/\bquarterly results\b/gi, '분기 실적'],
  [/\bquarterly earnings\b/gi, '분기 실적'],
  [/\bearnings beat\b/gi, '실적 서프라이즈'],
  [/\bearnings miss\b/gi, '실적 미달'],
  [/\btarget price\b/gi, '목표가'],
  [/\bprice target\b/gi, '목표가'],
  [/\bstock split\b/gi, '주식분할'],
  [/\bshare buyback\b/gi, '자사주매입'],
  [/\bstock buyback\b/gi, '자사주매입'],
  [/\bshare repurchase\b/gi, '자사주매입'],
  [/\binitial public offering\b/gi, 'IPO'],
  [/\bmerger and acquisition\b/gi, '인수합병'],
  [/\bmergers and acquisitions\b/gi, '인수합병'],
  [/\bmarket cap\b/gi, '시가총액'],
  [/\bafter hours\b/gi, '시간외'],
  [/\bpre-?market\b/gi, '프리마켓'],
  [/\byear-over-year\b/gi, '전년 대비'],
  [/\bquarter-over-quarter\b/gi, '전분기 대비'],
  [/\ball-time high\b/gi, '사상 최고치'],
  [/\brecord high\b/gi, '신고가'],
  [/\bboard of directors\b/gi, '이사회'],
  [/\bsupply chain\b/gi, '공급망'],
  [/\bgross margin\b/gi, '매출총이익률'],
  [/\boperating margin\b/gi, '영업이익률'],
  [/\bnet income\b/gi, '순이익'],
  [/\boperating income\b/gi, '영업이익'],
  [/\bfiscal year\b/gi, '회계연도'],
];

const WORD_MAP: [RegExp, string][] = [
  [/\bQ1\b/g, '1분기'],
  [/\bQ2\b/g, '2분기'],
  [/\bQ3\b/g, '3분기'],
  [/\bQ4\b/g, '4분기'],
  [/\bearnings\b/gi, '실적'],
  [/\brevenue\b/gi, '매출'],
  [/\bsales\b/gi, '매출'],
  [/\bbeat(?:s|en)?\b/gi, '서프라이즈'],
  [/\btopped\b/gi, '서프라이즈'],
  [/\bexceeds?\b/gi, '상회'],
  [/\bmiss(?:es|ed)?\b/gi, '미달'],
  [/\bupgrades?\b/gi, '등급 상향'],
  [/\bdowngrades?\b/gi, '등급 하향'],
  [/\bsurges?\b/gi, '급등'],
  [/\bsoars?\b/gi, '급등'],
  [/\bjumps?\b/gi, '급등'],
  [/\brall(?:y|ies)\b/gi, '급등'],
  [/\bdrops?\b/gi, '급락'],
  [/\bfalls?\b/gi, '하락'],
  [/\bplunges?\b/gi, '급락'],
  [/\bslides?\b/gi, '하락'],
  [/\btumbles?\b/gi, '급락'],
  [/\bsinks?\b/gi, '급락'],
  [/\bskyrockets?\b/gi, '폭등'],
  [/\bcrash(?:es)?\b/gi, '폭락'],
  [/\bannounces?\b/gi, '발표'],
  [/\bunveils?\b/gi, '공개'],
  [/\blaunch(?:es)?\b/gi, '출시'],
  [/\bacquisitions?\b/gi, '인수'],
  [/\bacquires?\b/gi, '인수'],
  [/\bmergers?\b/gi, '합병'],
  [/\bdividends?\b/gi, '배당'],
  [/\bbuybacks?\b/gi, '자사주매입'],
  [/\banalysts?\b/gi, '애널리스트'],
  [/\bguidance\b/gi, '가이던스'],
  [/\bforecast\b/gi, '전망'],
  [/\boutlook\b/gi, '전망'],
  [/\bexpectations?\b/gi, '예상치'],
  [/\bestimates?\b/gi, '추정치'],
  [/\bconsensus\b/gi, '컨센서스'],
  [/\bprofit\b/gi, '이익'],
  [/\bloss(?:es)?\b/gi, '손실'],
  [/\bdebt\b/gi, '부채'],
  [/\blayoffs?\b/gi, '감원'],
  [/\bhiring\b/gi, '채용'],
  [/\bIPO\b/g, '상장'],
  [/\bCEO\b/g, 'CEO'],
  [/\bCFO\b/g, 'CFO'],
  [/\bsettlement\b/gi, '합의'],
  [/\blawsuit\b/gi, '소송'],
  [/\bregulat(?:ory|ion)\b/gi, '규제'],
  [/\bapproval\b/gi, '승인'],
  [/\bFDA\b/g, 'FDA'],
  [/\binvestors?\b/gi, '투자자'],
  [/\bshareholders?\b/gi, '주주'],
  [/\bstakeholders?\b/gi, '이해관계자'],
  [/\bpartnership\b/gi, '파트너십'],
  [/\brestructuring\b/gi, '구조조정'],
  [/\bexpansion\b/gi, '확장'],
  [/\bgrowth\b/gi, '성장'],
  [/\bdecline\b/gi, '감소'],
  [/\brecession\b/gi, '경기침체'],
  [/\binflation\b/gi, '인플레이션'],
  [/\binterest rate\b/gi, '금리'],
  [/\btariffs?\b/gi, '관세'],
];

function translateTitle(title: string): string {
  let result = title;
  for (const [re, ko] of PHRASE_MAP) {
    result = result.replace(re, ko);
  }
  for (const [re, ko] of WORD_MAP) {
    result = result.replace(re, ko);
  }
  if (result === title) return title;
  return result;
}

export function translateNewsItems(items: NewsItem[]): NewsItem[] {
  return items.map((item) => {
    if (item.titleKo) return item;
    const translated = translateTitle(item.title);
    if (translated === item.title) return item;
    return { ...item, titleKo: translated };
  });
}
