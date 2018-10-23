/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import * as extfs from 'vs/base/node/extfs';
import { IFileMatch, IProgress, ITextQuery, ITextSearchStats } from 'vs/platform/search/common/search';
import { RipgrepTextSearchEngine } from 'vs/workbench/services/search/node/ripgrepTextSearchEngine';
import { TextSearchManager } from 'vs/workbench/services/search/node/textSearchManager';
import { ISerializedFileMatch, ISerializedSearchSuccess } from './search';

export class TextSearchEngineAdapter {

	constructor(private query: ITextQuery) {
	}

	search(token: CancellationToken, onResult: (matches: ISerializedFileMatch[]) => void, onMessage: (message: IProgress) => void): Promise<ISerializedSearchSuccess> {
		if (!this.query.folderQueries.length && !this.query.extraFileResources.length) {
			return Promise.resolve(<ISerializedSearchSuccess>{
				type: 'success',
				limitHit: false,
				stats: <ITextSearchStats>{
					type: 'searchProcess'
				}
			});
		}

		const pretendOutputChannel = {
			appendLine(msg) {
				onMessage({ message: msg });
			}
		};
		const textSearchManager = new TextSearchManager(this.query, new RipgrepTextSearchEngine(pretendOutputChannel), extfs);
		return new Promise((resolve, reject) => {
			return textSearchManager
				.search(
					matches => {
						onResult(matches.map(fileMatchToSerialized));
					},
					token)
				.then(
					() => resolve({ limitHit: false, stats: null, type: 'success' }),
					reject);
		});
	}
}

function fileMatchToSerialized(match: IFileMatch): ISerializedFileMatch {
	return {
		path: match.resource.fsPath,
		matches: match.matches,
		numMatches: match.matches.length
	};
}