# Bookbird landing page: what we need

Three files. Voice: plain and warm, short sentences, no hype.

1. **`teardown.csv`**: at least 4 competitor landing pages. Columns:
   `page, url, accessed, headline, cta_label, proof_type`
   (`accessed` is the date you read it, YYYY-MM-DD; `proof_type` is what they use as proof: numbers, logos,
   testimonials, awards…).
2. **`copy.md`**: at most 600 words.
   - `## Positioning`: one paragraph on who Bookbird is for and why it beats the alternatives.
   - Then five sections, `## S1 Hero` to `## S5 Final call to action`. Each has a `### headline`, one or two short
     paragraphs, and a line `CTA: <button label>`.
   - Every number comes from `facts.md` and carries its tag, like "no-shows fell to 6% [F3]".
3. **`mockup.html`**: one self-contained file the developer can open offline.
   - It uses every `###` headline from `copy.md` word for word, and no other copy longer than a short label.
   - The main button is marked `data-cta="primary"`, with the same label everywhere it appears.
   - No external fonts, images or scripts: nothing loads from the internet.
   - No testimonials, clinic logos or prices.
