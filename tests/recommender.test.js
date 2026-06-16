'use strict';

process.env.MOODLE_SECRET     = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

const MOCK_RECOMMENDATION = JSON.stringify({
    recommendation_type: 'next_activity',
    message: 'Buen trabajo, sigue así.',
    suggested_activities: [
        { title: 'Actividad de prueba', reason: 'Adecuada para tu nivel', estimated_minutes: 30 },
    ],
    next_level_hint: 'Necesitas 10 XP más.',
});

jest.mock('@anthropic-ai/sdk', () => {
    return jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockResolvedValue({
                content: [{ text: MOCK_RECOMMENDATION }],
            }),
        },
    }));
});

const request      = require('supertest');
const express      = require('express');
const recommRouter = require('../ai-layer/routes/recommender');

const app = express();
app.use(express.json());
app.use('/api/tutor', recommRouter);

const AUTH = 'Bearer test-secret';

const validBody = {
    userId: 'user-42',
    userName: 'Ana García',
    level: 1,
    xp: 60,
    evidenceCount: 2,
    lang: 'es',
};

describe('POST /api/tutor/recommend', () => {
    test('returns 200 with a recommendation object', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send(validBody);
        expect(res.status).toBe(200);
        expect(typeof res.body.recommendation_type).toBe('string');
        expect(typeof res.body.message).toBe('string');
        expect(Array.isArray(res.body.suggested_activities)).toBe(true);
    });

    test('rejects missing userId', async () => {
        const { userId: _, ...body } = validBody;
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send(body);
        expect(res.status).toBe(400);
    });

    test('rejects invalid level', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, level: 5 });
        expect(res.status).toBe(400);
    });

    test('rejects invalid lang', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, lang: 'fr' });
        expect(res.status).toBe(400);
    });

    test('rejects negative xp', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, xp: -5 });
        expect(res.status).toBe(400);
    });

    test('returns 401 without Authorization header', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .send(validBody);
        expect(res.status).toBe(401);
    });

    test('works without optional userName', async () => {
        const { userName: _, ...body } = validBody;
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send(body);
        expect(res.status).toBe(200);
    });

    test('rejects negative evidenceCount', async () => {
        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, evidenceCount: -1 });
        expect(res.status).toBe(400);
    });
});

describe('POST /api/tutor/recommend — AI response handling', () => {
    let mockCreate;

    beforeAll(() => {
        const Anthropic = require('@anthropic-ai/sdk');
        mockCreate = Anthropic.mock.results[0].value.messages.create;
    });

    beforeEach(() => {
        mockCreate.mockClear();
    });

    test('returns 502 when the AI response is not parseable JSON', async () => {
        mockCreate.mockResolvedValueOnce({ content: [{ text: 'No puedo ayudarte con eso.' }] });

        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'user-rec-badjson' });

        expect(res.status).toBe(502);
    });

    test('extracts JSON from a markdown code fence', async () => {
        mockCreate.mockResolvedValueOnce({
            content: [{ text: '```json\n' + MOCK_RECOMMENDATION + '\n```' }],
        });

        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'user-rec-fenced' });

        expect(res.status).toBe(200);
        expect(res.body.recommendation_type).toBe('next_activity');
    });

    test('normalizes an unrecognized recommendation_type to "next_activity"', async () => {
        mockCreate.mockResolvedValueOnce({
            content: [{ text: JSON.stringify({ recommendation_type: 'bogus_type' }) }],
        });

        const res = await request(app)
            .post('/api/tutor/recommend')
            .set('Authorization', AUTH)
            .send({ ...validBody, userId: 'user-rec-badtype' });

        expect(res.status).toBe(200);
        expect(res.body.recommendation_type).toBe('next_activity');
        expect(res.body.message).toBe('');
        expect(res.body.suggested_activities).toEqual([]);
    });
});
