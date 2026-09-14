/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IKnoxGuiBridge } from '../../contrib/knox/common/knoxGuiProtocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, ExtHostKnoxGuiShape, KnoxGuiMessageDto, MainContext, MainThreadKnoxGuiShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadKnoxGui)
export class MainThreadKnoxGui extends Disposable implements MainThreadKnoxGuiShape {
	private readonly _proxy: ExtHostKnoxGuiShape;

	constructor(
		extHostContext: IExtHostContext,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostKnoxGui);
		this._bridge.bindExtHost(this._proxy);
	}

	$push(message: KnoxGuiMessageDto): void {
		this._bridge.handlePush(message);
	}
}
