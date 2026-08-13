---
title: Pricing
description: 'Klad is free and open source under the GNU AGPL v3. A commercial licence covers closed-source and proprietary products — get in touch.'
# No outline rail: this page is a headline, two cards and three short sections,
# and a table of contents beside that is furniture. Dropping it gives the whole
# width back to the page, which is what the cards want.
aside: false
outline: false
---

<div class="price-hero">
  <p class="price-hero-figure">Always free</p>
  <p class="price-hero-line">
    Klad is open source under the GNU AGPL v3 — no seats, no tiers, no usage
    limits, no card. And the whole of it is: there is no cut-down edition with
    the good parts held back for a plan.
  </p>
</div>

There is one thing to know, and it is the AGPL's own condition rather than a
price: **what you build on it is open too.** If that does not work for your
product, there is a commercial licence, and that one is a conversation.

<div class="price-grid">
  <div class="price-card">
    <h3>Open source</h3>
    <p class="price-card-price">Free, forever</p>
    <ul>
      <li>Every feature, every package, every release — there is no cut-down edition</li>
      <li>Use it, modify it, fork it, redistribute it</li>
      <li>
        In return: what you ship it inside goes out under the AGPL too, so anyone
        it reaches — including over a network — can get that source
      </li>
      <li>
        Evaluating, prototyping or building internally, without shipping or
        hosting anything to third parties? Nothing to do at all
      </li>
    </ul>
  </div>
  <div class="price-card is-commercial">
    <h3>Commercial</h3>
    <p class="price-card-price">Get in touch</p>
    <ul>
      <li>Closed-source and proprietary products, shipped or hosted</li>
      <li>No obligation to release your own source</li>
      <li>The right to distribute the library inside your application</li>
      <li>Terms — scope, seats, support, duration — agreed in writing, per company</li>
    </ul>
    <p class="price-card-cta">
      <a href="mailto:yusuf@ozdemir.be">yusuf@ozdemir.be</a>
    </p>
  </div>
</div>

## Something built for you

Neither licence is a service, and some of what people ask for is not a licence
question at all:

- **A chart that looks like your product.** Everything the canvas draws is a
  theme token and everything on top of it is your own markup, so a design in
  your brand is configuration rather than a fork — the showcase on the home
  page is that, and nothing else.
- **A layout or a feature you need and this does not have.** The shape of a
  tree is a setting here precisely because there is more than one right answer;
  if yours is missing, it is worth a conversation.
- **Getting it into your codebase.** Migrating off whatever draws your charts
  today, wiring it to your data, making it fast on the size of tree you
  actually have.

Same address, and say which of these it is:
**[yusuf@ozdemir.be](mailto:yusuf@ozdemir.be)**.

## Which one is you

The AGPL is enough — and you owe nothing and need to tell nobody — when:

- your project is itself released under the AGPL, or a licence the AGPL lets
  you combine into an AGPL whole;
- you are evaluating, prototyping or developing internally without shipping or
  hosting anything to third parties;
- your use is genuinely private — you modify it and never convey it or make it
  available over a network.

Its central condition is that anyone you convey the software to — **including
users who interact with it over a network** — must be able to get the complete
corresponding source of your version, under the AGPL, including your own code
combined with it. This library runs in your users' browsers as part of your
application, which is what makes that condition reach your application too.

You need the commercial licence when:

- you ship it inside a closed-source product, installed or delivered as a web
  application;
- you offer it as part of a hosted or SaaS service and do not want to release
  that service's source;
- you need to sublicense it to your own customers;
- your organisation's policy or contracts prohibit AGPL dependencies — a
  common reason on its own, regardless of how you use it.

**Email [yusuf@ozdemir.be](mailto:yusuf@ozdemir.be)** with your company, the
product it would go into, whether it ships to customers or is internal only,
and rough scale. That is enough to quote against.

::: info
This page is a plain-language summary to help you work out which licence
applies to you. It is not legal advice and it does not modify either licence.
If the answer matters to you commercially, have your own counsel read the AGPL
against your intended use.
:::

## Contributing

Contributions are accepted under the AGPL. Because the project is
dual-licensed, a contributor licence agreement may be requested before a change
can be merged — without one, the copyright holder cannot offer that
contribution under the commercial licence. It is raised on the pull request; it
is not a prerequisite for opening one.

<style>
/*
 * `aside: false` gives the page the full content width, which for prose is too
 * much of a good thing — a 100-character line is hard to come back to. The
 * text is held to a readable measure and centred; the two things that WANT the
 * width, the headline and the cards, opt back out of it below.
 */
.vp-doc > div > :is(h2, p, ul, ol, blockquote, .custom-block) {
  /* `rem`, not `ch`: `ch` is font-relative, so the same number gives a heading
     a wider box than the paragraph under it and their left edges disagree. */
  max-width: 32rem;
  margin-inline: auto;
}

/*
 * The headline is the whole point of this page: somebody arriving at "Pricing"
 * has one question, and the answer is a word rather than a table. The
 * qualification sits in the same block rather than below the fold — "free" and
 * "your source is open too" are one fact, and splitting them across a scroll
 * would be the sort of pricing page this one is trying not to be.
 */
.vp-doc .price-hero {
  max-width: none;
  margin: 2rem 0 2.5rem;
  padding: 2.5rem 2rem;
  text-align: center;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.vp-doc .price-hero-figure {
  margin: 0;
  font-size: clamp(2.5rem, 8vw, 4rem);
  line-height: 1.05;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-3));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.vp-doc .price-hero-line {
  margin: 1rem auto 0;
  max-width: 46ch;
  color: var(--vp-c-text-2);
}

.vp-doc .price-grid {
  max-width: none;
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  margin: 2rem 0 3rem;
}
.vp-doc .price-card {
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
/* The paid one is not the recommended one, so it is outlined rather than
   promoted: it is the answer to a different question, not a better answer to
   this one. */
.vp-doc .price-card.is-commercial {
  border-color: var(--vp-c-brand-1);
}
.vp-doc .price-card h3 {
  margin: 0;
  border: 0;
  padding: 0;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}
.vp-doc .price-card-price {
  margin: 0.35rem 0 1rem;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.vp-doc .price-card ul {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--vp-c-text-2);
}
.vp-doc .price-card-cta {
  margin: 1.25rem 0 0;
  font-weight: 600;
}
</style>
