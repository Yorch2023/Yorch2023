'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const { validateMoodleToken } = require('../middleware/auth');
const { tutorLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const SYSTEM_PROMPT = fs.readFileSync(
    path.join(__dirname, '../prompts/recommender-system.txt'),
    'utf8'
);

// Provider selection: prefer Groq (free) when available, fall back to Anthropic.
const USE_GROQ = !!process.env.GROQ_API_KEY;

let anthropicClient = null;
function getAnthropic() {
    if (!anthropicClient) {
        const Anthropic = require('@anthropic-ai/sdk');
        anthropicClient = new Anthropic();
    }
    return anthropicClient;
}

async function callAI(userMessage) {
    if (USE_GROQ) {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
                max_tokens: 800,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user',   content: userMessage },
                ],
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw Object.assign(new Error(`Groq error ${res.status}: ${err}`), { status: res.status });
        }
        const data = await res.json();
        return data.choices[0]?.message?.content ?? '';
    }

    const client = getAnthropic();
    const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
    });
    return response.content[0]?.text ?? '';
}

/**
 * POST /api/tutor/recommend
 *
 * Analyses a learner's progress and returns personalised next-step
 * recommendations without exposing raw XP thresholds to the client.
 *
 * Body:
 *   userId       {string}   Moodle user ID (for rate limiting)
 *   userName     {string}   Display name (personalisation only, not logged)
 *   level        {number}   Current itinerary level: 1, 2 or 3
 *   xp           {number}   Accumulated XP at this level
 *   evidenceCount {number}  Evidence items submitted at this level
 *   lang         {string}   'es' or 'it'
 *
 * Returns:
 *   {
 *     recommendation_type: string,
 *     message: string,
 *     suggested_activities: Array<{ title, reason, estimated_minutes }>,
 *     next_level_hint: string | null
 *   }
 */
router.post('/recommend', validateMoodleToken, tutorLimiter, async (req, res, next) => {
    try {
        const { userId, userName, level, xp, evidenceCount, lang } = req.body;

        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (![1, 2, 3].includes(level)) {
            return res.status(400).json({ error: 'level must be 1, 2 or 3' });
        }

        if (typeof xp !== 'number' || xp < 0) {
            return res.status(400).json({ error: 'xp must be a non-negative number' });
        }

        if (typeof evidenceCount !== 'number' || evidenceCount < 0) {
            return res.status(400).json({ error: 'evidenceCount must be a non-negative number' });
        }

        if (!['es', 'it'].includes(lang)) {
            return res.status(400).json({ error: 'lang must be "es" or "it"' });
        }

        const name = userName && typeof userName === 'string'
            ? userName.slice(0, 100)
            : null;

        const userMessage = [
            name ? `Nombre del participante: ${name}` : null,
            `Nivel actual: N${level}`,
            `XP acumulados en este nivel: ${xp}`,
            `Evidencias enviadas en este nivel: ${evidenceCount}`,
            `Idioma de la respuesta: ${lang === 'es' ? 'español' : 'italiano'}`,
            'Por favor, devuelve exclusivamente el JSON de recomendación.',
        ].filter(Boolean).join('\n');

        const raw = await callAI(userMessage) || '{}';

        // Extract JSON from possible markdown code fence.
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
        let recommendation;
        try {
            recommendation = JSON.parse(jsonMatch[1].trim());
        } catch {
            return res.status(502).json({ error: 'Invalid recommendation response from AI' });
        }

        // Validate top-level shape before forwarding to client.
        const allowed = new Set(['next_activity', 'consolidation', 'level_up_ready', 'resources']);
        if (!allowed.has(recommendation.recommendation_type)) {
            recommendation.recommendation_type = 'next_activity';
        }
        if (typeof recommendation.message !== 'string') {
            recommendation.message = '';
        }
        if (!Array.isArray(recommendation.suggested_activities)) {
            recommendation.suggested_activities = [];
        }

        res.json(recommendation);

    } catch (err) {
        next(err);
    }
});

module.exports = router;
