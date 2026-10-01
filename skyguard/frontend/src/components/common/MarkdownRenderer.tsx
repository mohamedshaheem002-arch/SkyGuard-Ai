import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Lightweight, safe React Markdown renderer for AI Copilot responses.
 * Renders headings, bold, italics, lists, tables, code blocks, and blockquotes.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`text-xs leading-relaxed space-y-2.5 font-sans ${className}`}>
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).trim().split('\n');
          const language = lines[0]?.match(/^[a-zA-Z0-9_-]+$/) ? lines[0] : '';
          const code = language ? lines.slice(1).join('\n') : lines.join('\n');

          return (
            <div key={index} className="my-2 rounded bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto p-3 border border-slate-800">
              {language && (
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1.5 border-b border-slate-800 pb-1">
                  {language}
                </div>
              )}
              <pre className="whitespace-pre">{code}</pre>
            </div>
          );
        }

        return <TextBlock key={index} text={part} />;
      })}
    </div>
  );
};

const TextBlock: React.FC<{ text: string }> = ({ text }) => {
  const paragraphs = text.split(/\n\s*\n/);

  return (
    <>
      {paragraphs.map((paragraph, pIdx) => {
        const trimmed = paragraph.trim();
        if (!trimmed) return null;

        // Table detection
        if (trimmed.includes('|') && trimmed.split('\n').some((l) => l.trim().startsWith('|'))) {
          return <TableBlock key={pIdx} tableText={trimmed} />;
        }

        // List detection
        if (trimmed.split('\n').every((l) => /^\s*([*-]|\d+\.)\s+/.test(l))) {
          const lines = trimmed.split('\n');
          const isNumbered = /^\s*\d+\.\s+/.test(lines[0] || '');
          if (isNumbered) {
            return (
              <ol key={pIdx} className="list-decimal list-outside pl-4 space-y-1 my-1.5 text-slate-700">
                {lines.map((line, lIdx) => (
                  <li key={lIdx} className="pl-1">
                    {renderInlineFormatting(line.replace(/^\s*\d+\.\s+/, ''))}
                  </li>
                ))}
              </ol>
            );
          }
          return (
            <ul key={pIdx} className="list-disc list-outside pl-4 space-y-1 my-1.5 text-slate-700">
              {lines.map((line, lIdx) => (
                <li key={lIdx} className="pl-1">
                  {renderInlineFormatting(line.replace(/^\s*[*-]\s+/, ''))}
                </li>
              ))}
            </ul>
          );
        }

        // Heading detection
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={pIdx} className="text-xs font-bold text-slate-900 mt-2 mb-1">
              {renderInlineFormatting(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={pIdx} className="text-sm font-bold text-slate-900 mt-3 mb-1 border-b border-slate-100 pb-0.5">
              {renderInlineFormatting(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={pIdx} className="text-sm font-bold text-sky-900 mt-3 mb-1">
              {renderInlineFormatting(trimmed.slice(2))}
            </h2>
          );
        }

        // Standard paragraph (handle line breaks)
        const lines = trimmed.split('\n');
        return (
          <p key={pIdx} className="text-slate-800 leading-normal">
            {lines.map((l, lIdx) => (
              <React.Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInlineFormatting(l)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
};

const TableBlock: React.FC<{ tableText: string }> = ({ tableText }) => {
  const rawRows = tableText.split('\n').filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
  if (rawRows.length < 2) return <p className="text-slate-800">{tableText}</p>;

  // Check if second row is separator like |--|--|
  const isSeparator = (r: string) => /^\s*\|\s*[-:]+[-|\s:]*\|\s*$/.test(r);
  let headerRow = rawRows[0];
  let bodyRows = rawRows.slice(1);

  if (bodyRows.length > 0 && isSeparator(bodyRows[0])) {
    bodyRows = bodyRows.slice(1);
  }

  const parseCells = (row: string) =>
    row
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

  const headers = parseCells(headerRow);

  return (
    <div className="my-2.5 overflow-x-auto rounded border border-slate-200 bg-white shadow-2xs">
      <table className="w-full text-left text-[11px] font-mono divide-y divide-slate-200">
        <thead className="bg-slate-50 text-slate-700 font-semibold">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="py-2 px-2.5 whitespace-nowrap">
                {renderInlineFormatting(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-sans">
          {bodyRows.map((r, rIdx) => {
            const cells = parseCells(r);
            return (
              <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                {cells.map((c, cIdx) => (
                  <td key={cIdx} className="py-1.5 px-2.5 text-slate-700 text-xs">
                    {renderInlineFormatting(c)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function renderInlineFormatting(text: string): React.ReactNode {
  // Regex tokenization for bold, italic, code
  const tokens = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);

  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      return (
        <em key={idx} className="italic text-slate-800">
          {token.slice(1, -1)}
        </em>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code
          key={idx}
          className="font-mono text-[11px] bg-slate-100 text-sky-800 px-1 py-0.5 rounded border border-slate-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}
