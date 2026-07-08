import {type FeatureExtractionPipeline, pipeline} from '@xenova/transformers';

type LocalModel = {
	type: 'local';
	name: string;
	dimensions: number;
	defaultThreshold: number;
	queryPrefix?: string;
	passagePrefix?: string;
};

type OpenAIModel = {
	type: 'openai';
	name: string;
	dimensions: number;
	defaultThreshold: number;
	queryPrefix?: string;
	passagePrefix?: string;
};

type EmbeddingModel = LocalModel | OpenAIModel;

export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
	minilm: {type: 'local', name: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, defaultThreshold: 0.7},
	mpnet: {type: 'local', name: 'Xenova/all-mpnet-base-v2', dimensions: 768, defaultThreshold: 0.8},
	bge: {
		type: 'local',
		name: 'Xenova/bge-large-en-v1.5',
		dimensions: 1024,
		defaultThreshold: 0.5,
		queryPrefix: 'Represent this sentence for searching relevant passages: ',
		passagePrefix: '',
	},
	'openai-small': {type: 'openai', name: 'text-embedding-3-small', dimensions: 1536, defaultThreshold: 0.5},
	'openai-large': {type: 'openai', name: 'text-embedding-3-large', dimensions: 3072, defaultThreshold: 0.5},
} as const;

export type EmbeddingModelKey = keyof typeof EMBEDDING_MODELS;

export const DEFAULT_MODELS = Object.entries(EMBEDDING_MODELS)
	.filter(([, config]) => config.type === 'local')
	.map(([key]) => key) as EmbeddingModelKey[];

class EmbeddingService {
	private extractors: Map<string, FeatureExtractionPipeline> = new Map();

	async getExtractor(modelKey: string): Promise<FeatureExtractionPipeline> {
		const existing = this.extractors.get(modelKey);
		if (existing) {
			return existing;
		}

		const modelConfig = EMBEDDING_MODELS[modelKey];
		if (!modelConfig || modelConfig.type !== 'local') {
			throw new Error(`Model ${modelKey} is not a local model`);
		}

		const extractor = await pipeline('feature-extraction', modelConfig.name);
		this.extractors.set(modelKey, extractor);
		return extractor;
	}

	async generateEmbedding(
		text: string,
		modelKey: EmbeddingModelKey,
		options?: {isQuery?: boolean},
	): Promise<Float32Array> {
		const modelConfig = EMBEDDING_MODELS[modelKey];
		if (!modelConfig) {
			throw new Error(`Unknown model: ${modelKey}`);
		}

		const prefix = options?.isQuery ? (modelConfig.queryPrefix ?? '') : (modelConfig.passagePrefix ?? '');
		const prefixedText = prefix + text;

		if (modelConfig.type === 'openai') {
			return this.generateOpenAIEmbedding(prefixedText, modelConfig.name);
		}

		const extractor = await this.getExtractor(modelKey);
		const output = await extractor(prefixedText, {
			pooling: 'mean',
			normalize: true,
		});

		return new Float32Array(output.data as ArrayLike<number>);
	}

	private async generateOpenAIEmbedding(text: string, model: string): Promise<Float32Array> {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error('OPENAI_API_KEY environment variable is required for OpenAI embeddings');
		}

		const response = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				input: text,
				model,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${response.status} ${error}`);
		}

		const data = (await response.json()) as {data: Array<{embedding: number[]}>};
		return new Float32Array(data.data[0].embedding);
	}
}

export const embeddingService = new EmbeddingService();
