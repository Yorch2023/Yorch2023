'use strict';

process.env.MOODLE_SECRET = 'test-secret';
process.env.GROQ_API_KEY  = 'gsk-test';
delete process.env.ANTHROPIC_API_KEY;

const MOCK_PROFILE = {
    concepts_explored: ['sesgos'],
    mastery:           { 'sesgos algorítmicos': 1 },
};

const request = require('supertest');
const express = require('express');

global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(MOCK_PROFILE) } }] }),
});

const memoryRouter = require('../ai-layer/routes/memory');

const app = express();
app.use(express.json());
app.use('/api/memory', memoryRouter);

const AUTH = 'Bearer test-secret';

const twoMessages = [
    { role: 'user',      content: '¿Cómo afectan los sesgos en la IA a mis alumnos?' },
    { role: 'assistant', content: 'Los sesgos algorítmicos pueden reproducir desigualdades existentes...' },
];

describe('POST /api/memory/extract — Groq provider', () => {
    beforeEach(() => {
        global.fetch.mockClear();
    });

    test('uses Groq when GROQ_API_KEY is set and returns its profile', async () => {
        const res = await request(app)
            .post('/api/memory/extract')
            .set('Authorization', AUTH)
            .send({ userId: 'u-groq-1', messages: twoMessages });

        expect(res.status).toBe(200);
        expect(res.body.profile).toEqual(MOCK_PROFILE);
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.groq.com/openai/v1/chat/completions',
            expect.objectContaining({ method: 'POST' })
        );
    });

    test('returns a 500 when Groq responds with an error status', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
        });

        const res = await request(app)
            .post('/api/memory/extract')
            .set('Authorization', AUTH)
            .send({ userId: 'u-groq-2', messages: twoMessages });

        expect(res.status).toBe(500);
    });
});
