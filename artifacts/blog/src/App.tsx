import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@workspace/ui/toaster";
import { TooltipProvider } from "@workspace/ui/tooltip";
import Index from "@/pages/Index";
import Article from "@/pages/Article";
import Category from "@/pages/Category";
import Author from "@/pages/Author";
import Search from "@/pages/Search";
import Preview from "@/pages/Preview";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// On a client-side SPA the browser does not reset scroll between route changes,
// so navigating from the bottom of one page (e.g. a "More reads" card) lands you
// mid-page on the next. Reset to the top whenever the path changes.
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Index} />
      <Route path="/search" component={Search} />
      <Route path="/preview/:token" component={Preview} />
      <Route path="/category/:slug" component={Category} />
      <Route path="/author/:slug" component={Author} />
      <Route path="/:slug" component={Article} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ScrollToTop />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
