'use strict';

process.env.MOODLE_SECRET = 'test-secret';
process.env.GROQ_API_KEY  = 'gsk-test';
delete process.env.ANTHROPIC_API_KEY;

const MOCK_RECOMMENDATION = JSON.stringify({
    recommendation_type: 'next_activity',
    message: 'Recomendación vía Groq.',
    suggested_activities: [],
});

const request = require('supertest');
const express = require('express');

global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: MOCK_RECOMMENDATION } }] }),
});

const recommRouter = require('../ai-layer/routes/recommender');

const app = express();
app.use(express.json());
app.use('/api/tutor', recommRouter);

const AUTH = 'Bearer test-secret';

const validBody = {
    userId: 'user-groq-rec-1',
    userName: 'Ana García',
    level: 1,
    xp: 60,
    evidenceCount: 2,
    lang: 'es',
};

describe('POST /api/tutor/recommend — Groq provider', () => {
    beforeEach(() => {
        global.fetch.mockClear();
    });

    test('uses Groq when GROQ_API_KEY is set and returns its recommendation', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Recomendación vía Groq.');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.groq.com/openai/v1/chat/completions',
            expect.objectContaining({ method: 'POST' })
        );
    });

    test('propagates the upstream status when Groq responds with an error', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 503,
            text: async () => 'internal error',
        });

        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'user-groq-rec-2' });

        expect(res.status).toBe(503);
    });
});
