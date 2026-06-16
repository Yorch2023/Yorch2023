'use strict';

process.env.MOODLE_SECRET = 'test-secret';
process.env.GROQ_API_KEY  = 'gsk-test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const express = require('express');

global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '**Título**: Actividad vía Groq' } }] }),
});

const genRouter = require('../ai-layer/routes/generator');

const app = express();
app.use(express.json());
app.use('/api/generator', genRouter);

const AUTH = 'Bearer test-secret';

const validBody = {
    userId: 'user-groq-gen-1',
    level: 2,
    lang: 'es',
    topic: 'Sesgos algorítmicos',
};

describe('POST /api/generator/activity — Groq provider', () => {
    beforeEach(() => {
        global.fetch.mockClear();
    });

    test('uses Groq when GROQ_API_KEY is set and returns its activity', async () => {
        const res = await request(app)
            .post('/api/generator/activity')
            .set('Authorization', AUTH)
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.activity).toBe('**Título**: Actividad vía Groq');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.groq.com/openai/v1/chat/completions',
            expect.objectContaining({ method: 'POST' })
        );
    });

    test('propagates the upstream status when Groq responds with an error', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 503,
            text: async () => 'service unavailable',
        });

        const res = await request(app)
            .post('/api/generator/activity')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'user-groq-gen-2' });

        expect(res.status).toBe(503);
    });
});
