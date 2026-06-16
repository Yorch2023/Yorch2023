'use strict';

process.env.MOODLE_SECRET = 'test-secret';
process.env.GROQ_API_KEY  = 'gsk-test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const express = require('express');

global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Respuesta vía Groq.' } }] }),
});

const tutorRouter = require('../ai-layer/routes/tutor');

const app = express();
app.use(express.json());
app.use('/api/tutor', tutorRouter);

const AUTH = 'Bearer test-secret';

const validBody = {
    userId: 'user-groq-1',
    level: 1,
    lang: 'es',
    messages: [{ role: 'user', content: '¿Qué es la inteligencia artificial?' }],
};

describe('POST /api/tutor/chat — Groq provider', () => {
    beforeEach(() => {
        global.fetch.mockClear();
    });

    test('uses Groq when GROQ_API_KEY is set and returns its reply', async () => {
        const res = await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.reply).toBe('Respuesta vía Groq.');
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
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'user-groq-2' });

        expect(res.status).toBe(503);
    });
});
