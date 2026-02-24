class FuzzySearch {
    data: String[];

    constructor(data: String[]) {
        this.data = data;
    }

    private customDistance(q: string, s: string) {
        let distance = 0;
        let lastMatchIndex = -1;
        let matchedChars = 0;
        const matchesIdx: number[] = [];
        queryLoop:
        for (let i = 0; i < q.length; i++) {
            const qChar = q.charAt(i);
            let found = false;
            for (let j = lastMatchIndex + 1; j < s.length; j++) {
                const sChar = s.charAt(j);
                if (qChar === sChar) {
                    // Exact match, no penalty
                    lastMatchIndex = j;
                    matchesIdx.push(j);
                    matchedChars++;
                    found = true;
                    continue queryLoop;
                } else {
                    // Different characters, add penalty
                    distance += 1; // Penalty for each unmatched character in s
                }
            }
            if (!found) {
                distance += s.length; // Penalty for unmatched characters in s
            }
        }
        distance += s.length - matchedChars; // Penalty for unmatched characters in s
        return [distance, matchesIdx] as const;
    }

    search(query: string, threshold = 0.3) {
        const results = this.data.map(item => {
            const [distance, matchesIdx] = this.customDistance(query.toLowerCase(), item.toLowerCase());
            const maxLen = Math.max(query.length, item.length);
            const score = Math.exp(-distance / (maxLen * 2));
            return { item, score, matchesIdx };
        }).filter(result => result.score >= threshold);
        // Sort results by score in descending order
        results.sort((a, b) => b.score - a.score);
        return results.map(result => {
            return { item: result.item, matchesIdx: result.matchesIdx };
        }) as { item: string, matchesIdx: number[]; }[];
    }
}

export default FuzzySearch;