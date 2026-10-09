import { createRoot } from "react-dom/client";
import { TheFinder } from "@thefinder/react";
import "@thefinder/react/styles.css";

createRoot(document.getElementById("root")!).render(<TheFinder endpoint="/api/files" />);
