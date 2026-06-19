import type { FaqItem } from "@workspace/api-client-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/accordion";

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="my-16">
      <h2 className="font-serif text-2xl md:text-3xl text-foreground mb-8">
        Frequently asked questions
      </h2>
      <Accordion type="single" collapsible className="w-full">
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger className="text-left font-serif text-lg text-foreground">
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
