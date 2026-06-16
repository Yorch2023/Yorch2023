'use strict';

process.env.MOODLE_SECRET    = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

jest.mock('@anthropic-ai/sdk', () => {
    return jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockResolvedValue({
                content: [{ text: 'Respuesta del tutor de prueba.' }],
            }),
        },
    }));
});

const request     = require('supertest');
const express      = require('express');
const tutorRouter = require('../ai-layer/routes/tutor');

const app = express();
app.use(express.json());
app.use('/api/tutor', tutorRouter);

const AUTH = 'Bearer test-secret';

const baseBody = {
    level: 1,
    lang: 'es',
    messages: [{ role: 'user', content: '¿Qué es la inteligencia artificial?' }],
};

describe('POST /api/tutor/chat — validation gaps', () => {
    test('returns 400 when userId is missing', async () => {
        const res = await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send(baseBody);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/userId/);
    });
});

describe('POST /api/tutor/chat — learnerMemory profile injection', () => {
    let mockCreate;

    beforeAll(async () => {
        // Trigger one request so the lazily-instantiated Anthropic client exists.
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-warmup' });

        const Anthropic = require('@anthropic-ai/sdk');
        mockCreate = Anthropic.mock.results[0].value.messages.create;
    });

    beforeEach(() => {
        mockCreate.mockClear();
    });

    test('includes the full learner profile section when all fields are present', async () => {
        const learnerMemory = {
            concepts_explored: ['sesgos', 'privacidad'],
            mastery: { sesgos: 2, privacidad: 1 },
            strengths: 'Conecta bien la IA con su contexto educativo.',
            growth_areas: 'Necesita profundizar en marcos regulatorios.',
            context: 'Docente de secundaria',
            learning_style: 'analogies',
            recurring_questions: ['¿Qué es un sesgo algorítmico?'],
            sessions_total: 4,
        };

        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-mem-1', learnerMemory });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).toContain('Temas ya trabajados con este alumno: sesgos, privacidad');
        expect(systemText).toContain('Nivel de comprensión por concepto');
        expect(systemText).toContain('Puntos fuertes del alumno');
        expect(systemText).toContain('Áreas donde necesita más apoyo');
        expect(systemText).toContain('Contexto profesional relevante');
        expect(systemText).toContain('Estilo de aprendizaje: conecta mejor con analogías');
        expect(systemText).toContain('Dudas recurrentes');
        expect(systemText).toContain('Sesiones previas: 4');
    });

    test('omits the learner profile section when learnerMemory has no usable fields', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-mem-2', learnerMemory: {} });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).not.toContain('Perfil de aprendizaje del alumno');
    });

    test('falls back to the raw learning_style value when it has no known label', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-mem-3', learnerMemory: { learning_style: 'unusual_style' } });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).toContain('Estilo de aprendizaje: unusual_style');
    });

    test('does not add a learning-style line when style is "mixed"', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-mem-4', learnerMemory: { learning_style: 'mixed', strengths: 'x' } });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).not.toContain('Estilo de aprendizaje');
    });
});

describe('POST /api/tutor/chat — diagnosticProfile sector adaptation', () => {
    let mockCreate;

    beforeAll(async () => {
        // Trigger one request so the lazily-instantiated Anthropic client exists.
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-warmup' });

        const Anthropic = require('@anthropic-ai/sdk');
        mockCreate = Anthropic.mock.results[0].value.messages.create;
    });

    beforeEach(() => {
        mockCreate.mockClear();
    });

    test('adds Spanish sector context for an education professional with goals', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({
                ...baseBody,
                userId: 'user-dp-1',
                diagnosticProfile: { employment: 'education', goals: ['understand', 'work_tools'] },
            });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).toContain('Contexto profesional del aprendiz');
        expect(systemText).toContain('trabaja en el sector educativo');
        expect(systemText).toContain('comprender la IA');
        expect(systemText).toContain('Usa ejemplos del sector educativo');
    });

    test('adds Italian sector context for a job seeker', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({
                ...baseBody,
                userId: 'user-dp-2',
                lang: 'it',
                diagnosticProfile: { employment: 'job_seeker', goals: ['protect'] },
            });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).toContain('Contesto professionale del discente');
        expect(systemText).toContain('è in cerca di lavoro');
        expect(systemText).toContain('proteggersi dai rischi');
    });

    test('handles a retired user with no goals', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({
                ...baseBody,
                userId: 'user-dp-3',
                diagnosticProfile: { employment: 'retired', goals: [] },
            });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).toContain('está jubilado/a o en excedencia');
        expect(systemText).not.toContain('Objetivos:');
    });

    test('omits sector section entirely when diagnosticProfile is empty', async () => {
        await request(app)
            .post('/api/tutor/chat')
            .set('Authorization', AUTH)
            .send({ ...baseBody, userId: 'user-dp-4', diagnosticProfile: {} });

        const systemText = mockCreate.mock.calls[0][0].system[1].text;
        expect(systemText).not.toContain('Contexto profesional del aprendiz');
    });
});
