import React from "react";
import { RichSegment } from "@/data/content";

interface RichTextProps {
  segments: RichSegment[];
  className?: string;
}

export function RichText({ segments, className = "" }: RichTextProps) {
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.href) {
          return (
            <a
              key={index}
              href={segment.href}
              className="text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary transition-all duration-200"
              target={segment.href.startsWith("http") ? "_blank" : undefined}
              rel={segment.href.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              {segment.text}
            </a>
          );
        }
        return <React.Fragment key={index}>{segment.text}</React.Fragment>;
      })}
    </span>
  );
}
