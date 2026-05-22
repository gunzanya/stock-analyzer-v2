import type { NewsItem } from '../lib/types.js';

interface Props {
  news: NewsItem[];
}

export function NewsCard({ news }: Props) {
  if (news.length === 0) return null;
  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
      <h3 className="text-xs font-semibold text-slate-400 mb-3 tracking-wider uppercase flex items-center gap-1.5">
        <span>최근 뉴스</span>
      </h3>
      <ul className="space-y-2.5">
        {news.map((item, i) => (
          <li key={i}>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
            >
              <p className="text-[13px] text-slate-200 leading-snug group-hover:text-indigo-300 transition-colors line-clamp-2">
                {item.title}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {item.source}{item.source && item.date ? ' · ' : ''}{item.date}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
