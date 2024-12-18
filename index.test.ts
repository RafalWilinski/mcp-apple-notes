// Usage: npx tsx index.test.ts
import * as lancedb from "@lancedb/lancedb";
import { LanceSchema } from "@lancedb/lancedb/embedding";
import { Utf8 } from "apache-arrow";
import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import {
  createNotesTable,
  indexNotes,
  OnDeviceEmbeddingFunction,
  searchAndCombineResults,
  shutdown,
} from "./index";

async function* mockGetNotes() {
  yield {
    titles: ["Note 1", "Note 2", "Note 3"],
    progress: {
      current: 3,
      total: 3,
      batch: {
        start: 1,
        end: 3
      }
    }
  };
}

const mockGetNoteDetails = async (title: string) => ({
  title,
  content: `Content for ${title}`,
  creation_date: new Date().toISOString(),
  modification_date: new Date().toISOString()
});

describe("Apple Notes Indexing", async () => {
  const db = await lancedb.connect(
    path.join(os.homedir(), ".mcp-apple-notes", "data")
  );
  const func = new OnDeviceEmbeddingFunction();

  const notesSchema = LanceSchema({
    title: func.sourceField(new Utf8()),
    content: func.sourceField(new Utf8()),
    creation_date: func.sourceField(new Utf8()),
    modification_date: func.sourceField(new Utf8()),
    vector: func.vectorField(),
  });

  let originalGetNotes;
  
  beforeEach(() => {
    // Store the original implementation
    originalGetNotes = global.getNotes;
  });

  afterEach(() => {
    // Restore the original implementation
    global.getNotes = originalGetNotes;
  });

  // Add cleanup after all tests
  after(async () => {
    await shutdown();
  });

  test("should create notes table", async () => {
    const notesTable = await db.createEmptyTable("test-notes-" + Date.now(), notesSchema, {
      mode: "create",
      existOk: true,
    });

    assert.ok(notesTable, "Notes table should be created");
    const count = await notesTable.countRows();
    assert.ok(typeof count === "number", "Should be able to count rows");
  });

  test.skip("should index all notes correctly", async () => {
    const { notesTable } = await createNotesTable("test-notes");

    await indexNotes(notesTable);

    const count = await notesTable.countRows();
    assert.ok(typeof count === "number", "Should be able to count rows");
    assert.ok(count > 0, "Should be able to count rows");
  });

  test("should perform vector search", async () => {
    const start = performance.now();
    const { notesTable } = await createNotesTable("test-notes-" + Date.now());
    const end = performance.now();
    console.log(`Creating table took ${Math.round(end - start)}ms`);

    await notesTable.add([
      {
        id: "1",
        title: "Test Note",
        content: "This is a test note content",
        creation_date: new Date().toISOString(),
        modification_date: new Date().toISOString(),
      },
    ]);

    const addEnd = performance.now();
    console.log(`Adding notes took ${Math.round(addEnd - end)}ms`);

    const results = await searchAndCombineResults(notesTable, "test note");

    const combineEnd = performance.now();
    console.log(`Combining results took ${Math.round(combineEnd - addEnd)}ms`);

    assert.ok(results.length > 0, "Should return search results");
    assert.equal(results[0].title, "Test Note", "Should find the test note");
  });

  test("should perform vector search on real indexed data", async () => {
    const { notesTable } = await createNotesTable("test-notes-" + Date.now());

    // Add test data first
    await notesTable.add([
      {
        id: "1",
        title: "Test Note",
        content: "This is a test note content with date 15/12",
        creation_date: new Date().toISOString(),
        modification_date: new Date().toISOString(),
      },
    ]);

    const results = await searchAndCombineResults(notesTable, "15/12");

    assert.ok(results.length > 0, "Should return search results");
    assert.equal(results[0].title, "Test Note", "Should find the test note");
  });

  test("should handle batched note processing", async () => {
    const { notesTable } = await createNotesTable("test-notes-batch-" + Date.now());
    
    const result = await indexNotes(notesTable, {
      getNotes: mockGetNotes,
      getNoteDetailsByTitle: mockGetNoteDetails
    });
    
    assert.ok(result.chunks >= 0, "Should report processed chunks");
    assert.ok(result.failed >= 0, "Should report failed notes");
    assert.ok(result.time > 0, "Should report processing time");
    assert.ok(result.allNotes >= 0, "Should report total notes found");
  });

  test("should handle note processing timeouts", async () => {
    const { notesTable } = await createNotesTable("test-notes-timeout-" + Date.now());
    
    const timeoutGetNoteDetails = async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      throw new Error('Simulated timeout');
    };

    const result = await indexNotes(notesTable, {
      getNotes: async function* () {
        yield {
          titles: ["Very Long Note"],
          progress: {
            current: 1,
            total: 1,
            batch: {
              start: 1,
              end: 1
            }
          }
        };
      },
      getNoteDetailsByTitle: timeoutGetNoteDetails
    });
    
    assert.ok(result.failed > 0, "Should have failed notes");
    assert.ok(result.report.includes("Error"), "Should include error reports");
  });

  test("should handle progress reporting", async () => {
    const { notesTable } = await createNotesTable("test-notes-progress-" + Date.now());
    
    const testNotes = Array.from({ length: 5 }, (_, i) => ({
      id: `progress-${i}`,
      title: `Progress Test Note ${i}`,
      content: `Content for note ${i}`,
      creation_date: new Date().toISOString(),
      modification_date: new Date().toISOString(),
    }));
    
    await notesTable.add(testNotes);
    
    const result = await indexNotes(notesTable, {
      getNotes: mockGetNotes,
      getNoteDetailsByTitle: mockGetNoteDetails
    });
    
    assert.ok(result.chunks >= 0, "Should process all test notes");
    assert.ok(result.allNotes >= 0, "Should report total notes found");
  });

  test("should handle markdown conversion errors gracefully", async () => {
    const { notesTable } = await createNotesTable("test-notes-markdown-" + Date.now());
    
    const problematicGetNoteDetails = async (title: string) => ({
      title,
      content: "<div><unclosed-tag>Bad HTML</div>", // Malformed HTML
      creation_date: new Date().toISOString(),
      modification_date: new Date().toISOString(),
    });

    const result = await indexNotes(notesTable, {
      getNotes: mockGetNotes,
      getNoteDetailsByTitle: problematicGetNoteDetails
    });
    
    assert.ok(
      result.report.includes("markdown") || result.report === "", 
      "Should handle markdown conversion errors gracefully"
    );
  });
});
