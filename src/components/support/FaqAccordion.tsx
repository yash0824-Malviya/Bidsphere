import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface FaqItem {
  question: string;
  answer: ReactNode;
}

interface Props {
  items: FaqItem[];
}

export default function FaqAccordion({ items }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-neutral-100">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-neutral-50"
              aria-expanded={isOpen}
            >
              <span className="text-sm font-semibold text-neutral-900">
                {item.question}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-neutral-100 bg-neutral-50/50 px-5 py-4 text-sm leading-relaxed text-neutral-600">
                {item.answer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
