import type { Metadata } from "next";
import { Playground } from "./playground";
import "./playground.css";

export const metadata: Metadata = {
  title: "theFinder playground",
  description: "File picker hook and CKEditor 5 connector examples",
};

export default function Page() {
  return <Playground />;
}
