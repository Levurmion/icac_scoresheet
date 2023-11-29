import { CompletedMatch, LiveMatch, LiveMatchRedisType, MatchParams } from "../../lib/types"
import { persistentUserSignIn, testUsersSignIn } from "../../lib/utilities"

const supertest = require('supertest')
const agent = supertest.agent

const userAgent = agent('http://localhost:8001/api')

describe("Testing /matches endpoints", () => {

    // CRUD test data
    const badMatches = [
        {"name": "Mighty_Match_1@", "max_participants": 227, "num_ends": 200, "arrows_per_end": 166},
        {"name": "Swift_Match()_2", "max_participants": 197, "num_ends": 6, "arrows_per_end": 63},
        {"name": "Swift_Match_3", "num_ends": 117, "arrows_per_end": 75},
    ]
    const matchesToCreate = [
        {"name": "Mighty_Match_1", "max_participants": 2, "num_ends": 200, "arrows_per_end": 166},
        {"name": "Swift_Match_2", "max_participants": 197, "num_ends": 6, "arrows_per_end": 63},
        {"name": "Swift_Match_3", "max_participants": 24, "num_ends": 117, "arrows_per_end": 75},
        {"name": "Rapid_Match_9", "max_participants": 3, "num_ends": 214, "arrows_per_end": 114},
        {"name": "Mighty_Match_10", "max_participants": 17, "num_ends": 139, "arrows_per_end": 131}
    ]
    const existingMatches = [
        {"name": "Rapid_Match_9", "max_participants": 3, "num_ends": 214, "arrows_per_end": 114},
        {"name": "Mighty_Match_10", "max_participants": 17, "num_ends": 139, "arrows_per_end": 131}
    ]
    const matchNames = matchesToCreate.map(matchParams => matchParams.name)
    let liveMatchIds: string[]
    let completedMatchIds: string[]


    test("Sign In User: POST /auth/sign-in", async () => {
        const res = await userAgent.post('/auth/sign-in').send(persistentUserSignIn)
        expect(res.statusCode).toEqual(200)
    })

    test("Create a Match: POST /matches", async () => {
        // matches with missing fields or bad names
        for (const badMatch of badMatches) {
            const res = await userAgent.post('/matches').send(badMatch)
            expect(res.statusCode).toBe(400)
        }
        // create 10 unique matches
        for (const matchParams of matchesToCreate) {
            const res = await userAgent.post('/matches').send(matchParams)
            expect(res.statusCode).toEqual(201)
        }
        // matches with identical names
        for (const existingMatch of existingMatches) {
            const res = await userAgent.post('/matches').send(existingMatch)
            expect(res.statusCode).toBe(409)
        }
    })

    test("Retrieve Matches with Bad Requests: GET /matches/:match_name", async () => {
        // attempting to retrieve all matches without host constraint
        const allMatchRes = await userAgent
        .get("/matches/*")
        // attempting to retrieve a match that does not exist
        const noMatchRes = await userAgent
        .get("/matches/does_not_exist")
        // attempting to retrieve a live match with an invalid state
        const badStateMatchRes = await userAgent
        .get("/matches/_Match_")
        .query({
            state: "invalid state"
        })

        expect(allMatchRes.statusCode).toBe(400)
        expect(badStateMatchRes.statusCode).toBe(400)
        expect(noMatchRes.statusCode).toBe(204)
    })

    test("Retrieve Live Matches by Name: GET /matches/:match_name", async () => {
        const res = await userAgent
        .get("/matches/Match")
        .query({
            state: ["live"],
            host_only: true
        })
        const matchProperties = [
            "name",
            "max_participants",
            "arrows_per_end",
            "num_ends",
            "created_at",
            "current_end",
            "current_state",
            "previous_state",
            "host",
            "participants"
        ]
        const retrievedMatches = res.body
        const firstRetrievedMatch = retrievedMatches?.[0]
        liveMatchIds = retrievedMatches.map((match: LiveMatchRedisType) => {
            return match.id
        })

        // make sure returned object shape is correct
        expect(firstRetrievedMatch).toHaveProperty("id")
        expect(firstRetrievedMatch).toHaveProperty("value")
        matchProperties.forEach(prop => {
            expect(firstRetrievedMatch.value).toHaveProperty(prop)
        })
        
        // check that all 10 live matches were retrieved
        for (const retrievedMatch of retrievedMatches) {
            expect(matchNames).toContain(retrievedMatch.value.name)
        }
    })

    test("Retrieve Past Matches by Name: GET /matches/:match_name", async () => {
        const res = await userAgent
        .get('/matches/completed_match')
        const completedMatchProperties = [
            "competition",
            "finished_at",
            "host",
            "id",
            "name",
            "started_at"
        ]
        const pastMatchNames = [
            "completed_match1",
            "completed_match2"
        ]
        const retrievedPastMatches = res.body
        const firstRetrievedPastMatch = retrievedPastMatches?.[0]

        // make sure returned object shape is correct
        completedMatchProperties.forEach(prop => {
            expect(firstRetrievedPastMatch).toHaveProperty(prop)
        })

        // check that both past matches were retrieved
        for (const pastMatch of retrievedPastMatches) {
            expect(pastMatchNames).toContain(pastMatch.name)
        }

        // save match IDs for following tests
        completedMatchIds = retrievedPastMatches.map((match: CompletedMatch) => match.id)
    })

    test("Request Access to a Live Match: POST /matches/:match_id/reserve", async () => {
        const getMatchRes = await userAgent.get('/matches/Mighty_Match_1').query({
            state: "open"
        })
        const match: LiveMatchRedisType = getMatchRes.body?.[0]
        const matchId = match.id

        // initialize 3 user agents
        const userAgents = [
            agent('http://localhost:8001/api'),
            agent('http://localhost:8001/api'),
            agent('http://localhost:8001/api')
        ]

        // sign in all 3
        for (let i = 0; i < 3; i++) {
            const agent = userAgents[i]
            const signInRes = await agent.post('/auth/sign-in').send(testUsersSignIn[i])
            expect(signInRes.statusCode).toEqual(200)
        }

        // first two attempts to reserve match
        for (let i = 0; i < 2; i++) {
            const agent = userAgents[i]
            const matchJoinRes = await agent.post(`/matches/${matchId}/reserve`)
            expect(matchJoinRes.statusCode).toBe(200)
            // if attempts to reserve another match while this one is valid, will reject
            const secondMatchJoinRes = await agent.post(`/matches/${matchId}/reserve`)
            expect(secondMatchJoinRes.statusCode).toBe(403)
            const verifyTokenRes = await agent.get('/matches/token/validate')
            expect(verifyTokenRes.statusCode).toBe(200)
        }

        // third one should get 403 because Mighty_Match_1 only has a max_participants = 2
        const forbiddenMatchJoinRes = await userAgents[2].post(`/matches/${matchId}/reserve`)
        expect(forbiddenMatchJoinRes.statusCode).toBe(403)

        const verifyTokenRes = await userAgents[2].get('/matches/token/validate')
        expect(verifyTokenRes.statusCode).toBe(400)
    })

    test("Delete Live Matches by ID: DELETE /matches", async () => {
        for (const matchId of liveMatchIds) {
            const res = await userAgent.delete(`/matches/${matchId}`)
            expect(res.statusCode).toBe(200)
        }
    })

    test("Retrieve Results for Completed Match: GET /matches/:match_id/results", async () => {
        const matchId = (completedMatchIds)?.[0]
        const scoresheetProperties = [
            "id",
            "user_id",
            "arrows_shot",
            "arrows_per_end",
            "created_at",
            "match_id",
            "scoresheet"
        ]
        const res = await userAgent
        .get(`/matches/${matchId}/results`)

        const scoresheets = res.body
        const firstScoresheet = scoresheets[0]

        // check that scoresheet has at least the required properties
        scoresheetProperties.forEach(prop => {
            expect(firstScoresheet).toHaveProperty(prop)
        })

        // check that 2 scoresheets were retrieved (as per the dummy data setup)
        expect(scoresheets.length).toBe(2)

        const emptyRes = await userAgent
        .get(`/matches/empty/results`)

        // check that it return 204
        expect(emptyRes.statusCode).toBe(204)
    })

})