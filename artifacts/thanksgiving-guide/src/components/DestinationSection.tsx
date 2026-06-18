import { Destination, restaurantsHeading, attractionsHeading } from "@/data/content";
import { RichText } from "./RichText";
import { ExternalLink, Utensils, MapPin } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface DestinationSectionProps {
  destination: Destination;
}

export function DestinationSection({ destination }: DestinationSectionProps) {
  return (
    <section 
      id={destination.id} 
      className="scroll-mt-24 mb-20"
    >
      <div className="flex items-center gap-4 mb-8">
        <span className="text-4xl font-serif text-primary/40 font-light">
          {destination.number.toString().padStart(2, '0')}
        </span>
        <h2 className="text-3xl md:text-4xl font-serif text-foreground">
          {destination.name}
        </h2>
      </div>

      <div className="mb-10 rounded-2xl overflow-hidden shadow-md group">
        <AspectRatio ratio={16 / 9}>
          <img
            src={destination.image.src}
            alt={destination.image.alt}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        </AspectRatio>
      </div>

      <p className="text-base md:text-lg leading-relaxed text-foreground/80 mb-10">
        <RichText segments={destination.intro} />
      </p>

      <div className="grid md:grid-cols-2 gap-12">
        {/* Restaurants */}
        <div className="bg-card rounded-2xl p-8 shadow-sm border border-card-border hover-elevate transition-all duration-300">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
            <Utensils className="w-5 h-5 text-primary shrink-0" />
            <h3 className="font-medium text-foreground text-lg">{restaurantsHeading}</h3>
          </div>
          <ul className="space-y-4">
            {destination.restaurants.map((restaurant, idx) => (
              <li key={idx}>
                <a
                  href={restaurant.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between p-3 -mx-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="text-foreground/80 group-hover:text-primary transition-colors font-medium">
                    {restaurant.name}
                  </span>
                  <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Attractions */}
        <div className="bg-card rounded-2xl p-8 shadow-sm border border-card-border hover-elevate transition-all duration-300">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
            <MapPin className="w-5 h-5 text-primary shrink-0" />
            <h3 className="font-medium text-foreground text-lg">{attractionsHeading}</h3>
          </div>
          <ul className="space-y-6">
            {destination.attractions.map((attraction, idx) => (
              <li key={idx} className="group">
                {attraction.href ? (
                  <a
                    href={attraction.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-primary font-medium text-lg hover:underline decoration-primary/30 underline-offset-4 mb-2"
                  >
                    {attraction.title}
                    <ExternalLink className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                  </a>
                ) : (
                  <h4 className="text-foreground font-medium text-lg mb-2">
                    {attraction.title}
                  </h4>
                )}
                {attraction.description && (
                  <p className="text-muted-foreground leading-relaxed text-sm">
                    {attraction.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
