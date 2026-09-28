// A stand-in for the Anthropic Messages API. It answers clothing detection
// with two pieces and outfit styling with one look built from the wardrobe.
import http from "node:http";

export async function startMockClaude() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push({ url: req.url, headers: req.headers, body });
    const content = body.messages?.[0]?.content || [];
    const hasImage = content.some((block) => block.type === "image");
    let answer;
    if (hasImage) {
      answer = { items: [
        { name: "Navy tee", part: "upperbody", color: "#1F2A44", secondaryColor: null, tags: ["Cotton"], boundingBox: { x: 100, y: 50, width: 800, height: 450 } },
        { name: "Blue jeans", part: "lowerbody", color: "#3b5b8c", secondaryColor: "not a color", tags: ["denim"], boundingBox: { x: 150, y: 500, width: 700, height: 480 } },
      ] };
    } else {
      const text = content.find((block) => block.type === "text")?.text || "";
      const closet = JSON.parse(text.match(/<wardrobe>\s*([\s\S]*?)\s*<\/wardrobe>/)?.[1] || "[]");
      const top = closet.find((item) => item.category === "upperbody");
      const bottom = closet.find((item) => item.category === "lowerbody");
      answer = { outfits: [
        { name: "Easy Navy", occasion: ["Casual"], garmentIds: [top?.id, bottom?.id], reason: "Navy over blue denim stays calm." },
        { name: "Made up", occasion: [], garmentIds: ["import-missing"], reason: "Uses a piece that does not exist." },
      ] };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: `msg_${requests.length}`, type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
  await new Promise((resolve) => server.listen(Number(process.env.PORT) || 0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockClaude();
  console.log(mock.url);
}
