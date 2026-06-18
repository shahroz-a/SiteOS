import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";
import type { FaqItem } from "@workspace/api-client-react";

interface FaqSectionProps {
  items: FaqItem[];
}

export function FaqSection({ items }: FaqSectionProps) {
  if (items.length === 0) return null;
  const ordered = [...items].sort((a, b) => a.position - b.position);

  return (
    <section className="my-20" aria-labelledby="faq-heading">
      <div className="flex items-center gap-3 mb-8">
        <HelpCircle className="w-6 h-6 text-primary shrink-0" />
        <h2 id="faq-heading" className="font-serif text-3xl md:text-4xl text-foreground">
          Frequently asked questions
        </h2>
      </div>
      <Accordion type="single" collapsible className="w-full">
        {ordered.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger className="text-left text-lg font-medium text-foreground">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="text-base leading-relaxed text-foreground/80">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
