#!/usr/bin/env bun
import { createNotesTable, indexNotes } from "./index.js";

async function main() {
  console.log("🚀 Starting notes indexing process...\n");
  
  try {
    console.log("📁 Creating/connecting to notes database...");
    const { notesTable, time: setupTime } = await createNotesTable();
    console.log(`✅ Database setup complete (${(setupTime / 1000).toFixed(2)}s)\n`);
    
    console.log("📝 Fetching notes from Apple Notes...");
    const { chunks, time, allNotes, failed, report } = await indexNotes(notesTable);
    
    console.log("\n=== Indexing Complete ===");
    console.log(`📊 Stats:`);
    console.log(`• Total notes found: ${allNotes}`);
    console.log(`• Successfully indexed: ${chunks} notes`);
    console.log(`• Failed to process: ${failed} notes`);
    console.log(`• Time taken: ${(time / 1000).toFixed(2)} seconds`);
    
    if (report.trim()) {
      console.log("\n⚠️  Warnings/Issues:");
      console.log(report);
    }
    
    console.log("\n✨ Notes are now ready for semantic search!");
  } catch (error) {
    console.error("\n❌ Error while indexing notes:", error);
    process.exit(1);
  }
}

main(); 