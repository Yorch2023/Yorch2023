'use strict';

process.env.MOODLE_SECRET = 'test-secret';
process.env.GROQ_API_KEY  = 'gsk-test';
delete process.env.ANTHROPIC_API_KEY;

const request = require('supertest');
const express = require('express');

global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Recomendación vía Groq.' } }] }),
});

const advisorRouter = require('../ai-layer/routes/advisor');

const app = express();
app.use(express.json());
app.use('/api/advisor', advisorRouter);

const AUTH = 'Bearer test-secret';

const STUDENT_PROFILE = `Nombre: Ana García | Nivel: N2 | XP: 180/250 (72%)
Última actividad en itinerario: hace 12 días
Sesiones IA: 3 total, 0 esta semana
Evidencias: 2 entregadas (umbral N2: 4)
Riesgo calculado: 48/100 (medio)`;

const validBody = {
    userId:         'teacher-groq-1',
    lang:           'es',
    studentProfile: STUDENT_PROFILE,
    messages: [
        { role: 'user', content: '¿Qué estrategia me recomiendas para motivar a esta alumna?' },
    ],
};

describe('POST /api/advisor/chat — Groq provider', () => {
    beforeEach(() => {
        global.fetch.mockClear();
    });

    test('uses Groq when GROQ_API_KEY is set and returns its reply', async () => {
        const res = await request(app)
            .post('/api/advisor/chat')
            .set('Authorization', AUTH)
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.reply).toBe('Recomendación vía Groq.');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.groq.com/openai/v1/chat/completions',
            expect.objectContaining({ method: 'POST' })
        );
    });

    test('propagates the upstream status when Groq responds with an error', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 429,
            text: async () => 'rate limited',
        });

        const res = await request(app)
            .post('/api/advisor/chat')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'teacher-groq-2' });

        expect(res.status).toBe(429);
    });
});
