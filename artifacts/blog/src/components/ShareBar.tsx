import { useState } from "react";
import { Link2, Check, Twitter, Facebook, Linkedin } from "lucide-react";
import { Button } from "@workspace/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/tooltip";

interface ShareBarProps {
  url: string;
  title: string;
}

export function ShareBar({ url, title }: ShareBarProps) {
  const [isCopied, setIsCopied] = useState(false);

  const fullUrl = url.startsWith("http") ? url : `https://headout.com${url}`;
  
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link", err);
    }
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          url: fullUrl,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Error sharing", err);
        }
      }
    } else {
      handleCopyLink();
    }
  };

  const shareLinks = {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(fullUrl)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(fullUrl)}`,
    whatsapp: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title} ${fullUrl}`)}`,
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground mr-2 hidden sm:inline-block">Share:</span>
      
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full w-9 h-9 shrink-0 text-foreground hover:text-primary border-border/60 hover:bg-primary/5 hover:border-primary/20 transition-all"
            onClick={shareNative}
          >
            {isCopied ? (
              <Check className="w-4 h-4 text-primary" />
            ) : (
              <Link2 className="w-4 h-4" />
            )}
            <span className="sr-only">Copy link</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isCopied ? "Copied!" : "Copy link"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={shareLinks.x}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border/60 text-foreground hover:text-[#1DA1F2] hover:border-[#1DA1F2]/30 hover:bg-[#1DA1F2]/5 transition-all"
          >
            <Twitter className="w-4 h-4" />
            <span className="sr-only">Share on X</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>Share on X</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={shareLinks.facebook}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border/60 text-foreground hover:text-[#1877F2] hover:border-[#1877F2]/30 hover:bg-[#1877F2]/5 transition-all"
          >
            <Facebook className="w-4 h-4" />
            <span className="sr-only">Share on Facebook</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>Share on Facebook</TooltipContent>
      </Tooltip>
      
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={shareLinks.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border/60 text-foreground hover:text-[#0A66C2] hover:border-[#0A66C2]/30 hover:bg-[#0A66C2]/5 transition-all"
          >
            <Linkedin className="w-4 h-4" />
            <span className="sr-only">Share on LinkedIn</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>Share on LinkedIn</TooltipContent>
      </Tooltip>
    </div>
  );
}
